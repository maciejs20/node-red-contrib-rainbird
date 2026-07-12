/**
 * This file is based on code from [node-rainbird](https://github.com/bbreukelen/node-rainbird)
 * by @bbreukelen, licensed under the GNU GPL v3.
 * Original source: https://github.com/bbreukelen/node-rainbird
 *
 * Modifications by Maciej Szulc
 **/

const fetch = require("node-fetch");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const { TextEncoder, TextDecoder } = require("util");
const { AbortController } = require("abort-controller");
const aesjs = require("aes-js");

const sipCommands = require("./rainbird-sip-commands");

const NAK_BITS = {
	0x01: "Command Not Supported",
	0x02: "Bad Length",
	0x04: "Incompatible Data",
	0x08: "Checksum Error",
};

function decodeNak(hex) {
	const value = parseInt(hex, 16) || 0;
	const reasons = Object.keys(NAK_BITS)
		.map(Number)
		.filter((bit) => value & bit)
		.map((bit) => NAK_BITS[bit]);
	return { value, reasons: reasons.length ? reasons : [`Unknown (0x${hex})`] };
}

class RainBirdClass {
	constructor(ipAddress, password) {
		this.ip = ipAddress;
		this.password = password;
		this.debug = false;
		this.timeout = 7000; // request timeout in ms
		this.retryCount = 0; // number of retries
		this.retryDelay = 1000; // delay between retries
		this.logger = null; // external logger object (Node-RED or similar)
		this._mutex = Promise.resolve(); // ensures only one request at a time
		this._protocol = null; // detected on first request: 'https' or 'http'
		this._commandSupportCache = new Map();
		this._httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
		this._httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 1 });
		this._cbFailures = 0;    // consecutive connection-level failures
		this._cbOpenUntil = 0;   // epoch ms until circuit stays open
		this._cbThreshold = 3;   // failures before tripping
		this._cbCooldown = 90000; // 90s — manufacturer recommends >60s
	}

	// --- configuration ---
	setDebug() {
		this.debug = true;
	}
	setIp(ip) {
		this.ip = ip;
	}
	setPassword(password) {
		this.password = password;
	}
	setTimeout(ms) {
		this.timeout = ms;
	}
	setRetryCount(count) {
		this.retryCount = Math.max(0, parseInt(count, 10));
	}
	setRetryDelay(ms) {
		this.retryDelay = ms;
	}
	setLogger(node) {
		if (!node || typeof node !== "object") return;
		const requiredMethods = ["log", "warn", "error"];
		const missing = requiredMethods.filter((m) => typeof node[m] !== "function");
		if (missing.length > 0) console.warn("Logger missing methods: " + missing.join(", "));
		else this.logger = node;
	}

	// --- public API commands ---
	async getModelAndVersion() {
		return this._queue("ModelAndVersionRequest");
	}
	async getTime() {
		return this._queue("CurrentTimeRequest");
	}
	async getDate() {
		return this._queue("CurrentDateRequest");
	}
	async getSerialNumber() {
		return this._queue("SerialNumberRequest");
	}
	async getRainSensorState() {
		return this._queue("CurrentRainSensorStateRequest");
	}
	async getRainDelay() {
		return this._queue("RainDelayGetRequest");
	}
	async getAvailableZones() {
		return this._queue("AvailableStationsRequest", this.decToHex(0));
	}
	async getWaterBudgetRequest(program) {
		return this._queue("WaterBudgetRequest", this.decToHex(program));
	}
	async getSeasonalAdjust(program) {
		return this._queue("ZonesSeasonalAdjustFactorRequest", this.decToHex(program));
	}
	async getIrrigationState() {
		return this._queue("CurrentIrrigationStateRequest");
	}
	async getActiveZones() {
		return this._queue("CurrentStationsActiveRequest", this.decToHex(0));
	}
	async stopIrrigation() {
		return this._queue("StopIrrigationRequest");
	}
	async setRainDelay(days) {
		return this._queue("RainDelaySetRequest", this.decToHex(days, 4));
	}
	async startZone(zone, minutes) {
		return this._queue("ManuallyRunStationRequest", this.decToHex(zone, 4), this.decToHex(minutes));
	}
	async startAllZones(minutes) {
		return this._queue("TestStationsRequest", this.decToHex(minutes));
	}
	async startProgram(programNr) {
		return this._queue("ManuallyRunProgramRequest", this.decToHex(programNr));
	}
	async retrieveSchedule(page = 0x00, index = 0x00) {
		// this is not implemented as my ESP-ME3 does not support this command so I can't test it
		return this._queue("RetrieveScheduleRequest", this.decToHex(page), this.decToHex(index));
	}
	async checkCommandSupport(command) {
		if (this._commandSupportCache.has(command)) return this._commandSupportCache.get(command);
		const result = await this._queue("CommandSupportRequest", this.decToHex(command));
		const supported = result && parseInt(result.support, 16) !== 0;
		this._commandSupportCache.set(command, supported);
		return supported;
	}
	async getCombinedControllerState() {
		return this._queue("CombinedControllerStateRequest");
	}

	// --- queue ensures one request at a time ---
	async _queue(command, ...params) {
		if (!this.queueLength) this.queueLength = 0;

		if (Date.now() < this._cbOpenUntil) {
			const remaining = Math.ceil((this._cbOpenUntil - Date.now()) / 1000);
			throw new Error(`Circuit breaker open — controller recovery in progress (${remaining}s remaining)`);
		}

		this.queueLength++;

		const MAX_QUEUE_DEPTH = 15;

		if (this.queueLength > MAX_QUEUE_DEPTH) {
			this.queueLength--;
			throw new Error(`Queue depth exceeded maximum of ${MAX_QUEUE_DEPTH}`);
		}

		const result = this._mutex
			.then(async () => {
				await new Promise((res) => setTimeout(res, 100));
				// fast-fail requests that were queued before the circuit opened
				if (Date.now() < this._cbOpenUntil) {
					const remaining = Math.ceil((this._cbOpenUntil - Date.now()) / 1000);
					throw new Error(`Circuit breaker open (${remaining}s remaining)`);
				}
				return this._request(command, ...params);
			})
			.finally(() => {
				this.queueLength--;
			});

		this._mutex = result.catch(() => {}); // preserve chain
		return result;
	}

	// --- logger ---
	log(msg, level = "debug") {
		const proto = this._protocol ? `[${this._protocol.toUpperCase()}] ` : "";
		const message = proto + (typeof msg === "object" ? JSON.stringify(msg) : msg);
		if (!this.debug && level === "debug") return;
		if (level === "debug") level = "log";
		const validLevels = ["log", "warn", "error"];
		const normalizedLevel = validLevels.includes(level) ? level : "log";
		if (this.logger) this.logger[normalizedLevel](message);
		else console[normalizedLevel](message);
	}

	// --- protocol detection and fetch ---
	async _fetch(body, signal) {
		const opts = this.makeRequestOptions(body);

		if (this._protocol === "https") return fetch(`https://${this.ip}/stick`, { ...opts, agent: this._httpsAgent, signal });
		if (this._protocol === "http") return fetch(`http://${this.ip}/stick`, { ...opts, agent: this._httpAgent, signal });

		// Protocol unknown — try HTTP first, fall back to HTTPS once on connection failure
		try {
			const res = await fetch(`http://${this.ip}/stick`, { ...opts, agent: this._httpAgent, signal });
			this._protocol = "http";
			return res;
		} catch (err) {
			if (err.name === "AbortError") throw err;
			this.log(`HTTP failed (${err.message}), trying HTTPS`);
			const res = await fetch(`https://${this.ip}/stick`, { ...opts, agent: this._httpsAgent, signal });
			this._protocol = "https";
			this.log("HTTP unavailable, switched to HTTPS permanently");
			return res;
		}
	}

	_resetAgents() {
		this._httpAgent.destroy();
		this._httpsAgent.destroy();
		this._httpAgent = new http.Agent({ keepAlive: true, maxSockets: 1 });
		this._httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false, maxSockets: 1 });
		this.log("HTTP agents reset after timeout", "warn");
	}

	_recordFailure() {
		this._cbFailures++;
		if (this._cbFailures >= this._cbThreshold) {
			this._cbOpenUntil = Date.now() + this._cbCooldown;
			this._cbFailures = 0;
			this.log(`Circuit breaker opened — controller unresponsive, cooldown ${this._cbCooldown / 1000}s`, "warn");
		}
	}

	destroy() {
		this._httpAgent.destroy();
		this._httpsAgent.destroy();
		this._commandSupportCache.clear();
		this._protocol = null;
		this._cbFailures = 0;
		this._cbOpenUntil = 0;
	}

	// --- actual request execution ---
	async _request(command, ...params) {
		const commandData = sipCommands.ControllerCommands[command];
		if (!commandData) throw new Error("Invalid command");

		const maxAttempts = this.retryCount > 0 ? this.retryCount : 1;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				this.log(`[D:${this.queueLength}] Requesting ${command} from ${this.ip} (attempt ${attempt})`);

				const body = this.encrypt(this.makeBody(commandData, params));
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), this.timeout);

				const res = await this._fetch(body, controller.signal);
				clearTimeout(timeoutId);
				if (!res.ok) {
					const httpErr = new Error(`${res.status}: ${res.statusText}`);
					httpErr.httpStatus = res.status;
					throw httpErr;
				}

				const data = Buffer.from(await res.arrayBuffer());
				const response = this.processResponse(data);

				this.log(`[D:${this.queueLength}] Response ${command}: ${JSON.stringify(response)}`);
				this._cbFailures = 0;
				return response;
			} catch (err) {
				const isTimeout = err.name === "AbortError";
				const isConnFailure = isTimeout || ["ECONNRESET", "ECONNREFUSED"].includes(err.code);
				const isBusy = err.httpStatus === 503 || err.rpcCode === -32002 || err.isChecksumError;
				const isRetryable = isConnFailure || isBusy;
				const rethrow = isTimeout ? new Error(`Timeout after ${this.timeout}ms — no response from controller (${command})`) : err;
				this.log(`Error: ${rethrow.message}`, "error");
				if (isTimeout) this._resetAgents();
				if (isRetryable && attempt < maxAttempts) {
					this.log(`Retrying in ${this.retryDelay}ms`);
					await new Promise((r) => setTimeout(r, this.retryDelay));
				} else {
					if (isConnFailure) this._recordFailure();
					throw rethrow;
				}
			}
		}
	}

	// --- helpers for request building and response processing ---
	makeBody(commandObj, params) {
		let command = commandObj.command;
		(params || []).forEach((param) => (command += param));
		if (command.length / 2 !== commandObj.length) throw new Error("Invalid parameters");
		return { id: 9, jsonrpc: "2.0", method: "tunnelSip", params: { data: command, length: commandObj.length } };
	}

	makeRequestOptions(body) {
		return {
			method: "POST",
			body: Buffer.isBuffer(body) ? body : Buffer.from(body),
			headers: {
				"Accept-Language": "en",
				"Accept-Encoding": "gzip, deflate",
				"User-Agent": "RainBird/2.0",
				Accept: "*/*",
				Connection: "keep-alive",
				"Content-Type": "application/octet-stream",
			},
		};
	}

	processResponse(data) {
		const response = this.unpackResponse(data);
		if (!response) throw new Error("No response received");
		if (response.error) {
			const rpcErr = new Error(`Controller error ${response.error.code}: ${response.error.message}`);
			rpcErr.rpcCode = response.error.code;
			throw rpcErr;
		}
		if (!response.result) throw new Error("Invalid response");

		const resultLength = response.result.length;
		const resultData = response.result.data;
		const resultCode = resultData.substring(0, 2);
		const resultObj = sipCommands.ControllerResponses[resultCode];

		this.log(
			`Response resultCode: ${resultCode}, resultObj: ${JSON.stringify(resultObj)}, resultData: ${JSON.stringify(
				resultData
			)}`,
			"debug"
		);

		if (!resultObj) throw new Error("Response code not found");
		if (resultObj.length !== null && resultLength !== resultObj.length)
			throw new Error("Invalid response length: " + resultLength);

		const output = {};
		Object.keys(resultObj).forEach((key) => {
			if (typeof resultObj[key] === "object" && "position" in resultObj[key] && "length" in resultObj[key]) {
				output[key] = resultData.slice(resultObj[key].position, resultObj[key].position + resultObj[key].length);
			}
		});
		if (typeof resultObj.f === "function") resultObj.f(output);
		output._type = resultObj.type;

		if (resultCode === "00") {
			const { value: nakCode, reasons } = decodeNak(output.NAKCode);
			const nakErr = new Error(`Controller rejected command (NAK): ${reasons.join(", ")}`);
			nakErr.nakCode = nakCode;
			nakErr.nakReasons = reasons;
			nakErr.isChecksumError = !!(nakCode & 0x08);
			throw nakErr;
		}

		return output;
	}

	unpackResponse(data) {
		try {
			return JSON.parse(this.decrypt(data).replace(/[\x10\x0A\x00]/g, ""));
		} catch (err) {
			this.log("Decrypt/parse error: " + err.message, "error");
			return null;
		}
	}

	// --- cryptography helpers ---
	encrypt(body) {
		body = JSON.stringify(body);
		const passwordHash = crypto.createHash("sha256").update(this.toBytes(this.password)).digest();
		const randomBytes = crypto.randomBytes(16);
		const packedBody = this.toBytes(this.addPadding(body + "\x00\x10"));
		const hashedBody = crypto.createHash("sha256").update(this.toBytes(body)).digest();
		const aesEncryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes);
		const encryptedBody = Buffer.from(aesEncryptor.encrypt(packedBody));
		return Buffer.concat([hashedBody, randomBytes, encryptedBody]);
	}

	decrypt(data) {
		const passwordHash = crypto.createHash("sha256").update(this.toBytes(this.password)).digest().slice(0, 32);
		const randomBytes = data.slice(32, 48);
		const encryptedBody = data.slice(48);
		const aesDecryptor = new aesjs.ModeOfOperation.cbc(passwordHash, randomBytes);
		return new TextDecoder().decode(aesDecryptor.decrypt(encryptedBody));
	}

	toBytes(str) {
		return new TextEncoder("utf-8").encode(str);
	}
	addPadding(data) {
		const BLOCK_SIZE = 16;
		const charsToAdd = BLOCK_SIZE - (data.length % BLOCK_SIZE);
		return data + "\x10".repeat(charsToAdd);
	}
	decToHex(value, len) {
		return Math.abs(value)
			.toString(16)
			.toUpperCase()
			.padStart(len || 2, "0");
	}
	hexToDec(hex) {
		return parseInt(hex, 16);
	}

	outputAllToBoolean(o) {
		this.outputSomeTo(o, Object.keys(o), "bool");
	}
	outputAllToDecimal(o) {
		this.outputSomeTo(o, Object.keys(o), "dec");
	}
	outputSomeTo(o, keys, type) {
		(Array.isArray(keys) ? keys : [keys]).forEach((k) => {
			if (o.hasOwnProperty(k)) {
				switch (type) {
					case "dec":
						o[k] = this.hexToDec(o[k]);
						break;
					case "bool":
						o[k] = !!this.hexToDec(o[k]);
						break;
				}
			}
		});
	}
}

module.exports = RainBirdClass;

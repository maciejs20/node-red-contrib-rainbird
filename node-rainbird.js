/**
 * This file is based on code from [node-rainbird](https://github.com/bbreukelen/node-rainbird)
 * by @bbreukelen, licensed under the GNU GPL v3.
 * Original source: https://github.com/bbreukelen/node-rainbird
 *
 * Modifications by Maciej Szulc
 **/

const fetch = require("node-fetch");
const crypto = require("crypto");
const { TextEncoder, TextDecoder } = require("util");
const { AbortController } = require("abort-controller");
const aesjs = require("aes-js");

const sipCommands = require("./rainbird-sip-commands");

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
		const result = await this._queue("CommandSupportRequest", this.decToHex(command));
		return result && parseInt(result.support, 16) !== 0;
	}
	async getCombinedControllerState() {
		return this._queue("CombinedControllerStateRequest");
	}

	// --- queue ensures one request at a time ---
	async _queue(command, ...params) {
		this._mutex = this._mutex
			.then(() => this._request(command, ...params))
			.catch((err) => {
				this.log(`Queue error: ${err.message}`, "error");
				throw err;
			});
		return this._mutex;
	}

	// --- logger ---
	log(msg, level = "debug") {
		const message = typeof msg === "object" ? JSON.stringify(msg) : msg;
		if (!this.debug && level === "debug") return;
		if (level === "debug") level = "log";
		const validLevels = ["log", "warn", "error"];
		const normalizedLevel = validLevels.includes(level) ? level : "log";
		if (this.logger) this.logger[normalizedLevel](message);
		else console[normalizedLevel](message);
	}

	// --- actual request execution ---
	async _request(command, ...params) {
		const commandData = sipCommands.ControllerCommands[command];
		if (!commandData) throw new Error("Invalid command");

		const maxAttempts = this.retryCount > 0 ? this.retryCount : 1;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				this.log(`Requesting ${command} from ${this.ip} (attempt ${attempt})`);

				const body = this.encrypt(this.makeBody(commandData, params));
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), this.timeout);

				const res = await fetch(`http://${this.ip}/stick`, {
					...this.makeRequestOptions(body),
					signal: controller.signal,
				});
				clearTimeout(timeoutId);
				if (!res.ok) throw new Error(`${res.status}: ${res.statusText}`);

				const data = Buffer.from(await res.arrayBuffer());
				const response = this.processResponse(data);

				this.log(response);
				return response;
			} catch (err) {
				const isTimeout = err.name === "AbortError";
				const isRetryable = isTimeout || ["ECONNRESET", "ECONNREFUSED"].includes(err.code);
				this.log(`Error: ${err.message}`, "error");
				if (isRetryable && attempt < maxAttempts) {
					this.log(`Retrying in ${this.retryDelay}ms`);
					await new Promise((r) => setTimeout(r, this.retryDelay));
				} else throw err;
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
		if (response.error) throw new Error(`Controller error ${response.error.code}: ${response.error.message}`);
		if (!response.result) throw new Error("Invalid response");

		const resultLength = response.result.length;
		const resultData = response.result.data;
		const resultCode = resultData.substring(0, 2);
		const resultObj = sipCommands.ControllerResponses[resultCode];

		this.log(
			`Response resultCode: ${resultCode}, resultObj: ${JSON.stringify(resultObj)}, resultData: ${JSON.stringify(resultData)}`,
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

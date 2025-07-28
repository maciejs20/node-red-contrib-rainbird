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
		//console.log("--- node-rainbird setLogger call");

		if (!node || typeof node !== "object") return;
		const requiredMethods = ["log", "warn", "error"];
		const missing = requiredMethods.filter((m) => typeof node[m] !== "function");
		if (missing.length > 0) console.warn("Logger missing methods: " + missing.join(", "));
		else {
			//console.log("node-rainbird logger is set!");
			this.logger = node;
			// this.logger.log("Logging test for .log: confirmed.");
		}
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

		// Skip debug messages when debug mode is off
		if (!this.debug && level === "debug") return;

        //make debug = warn to work with node
        if (level==="debug") level="log";

		// Normalize level (only log, warn, error are allowed)
		const validLevels = ["log", "warn", "error"];
		const normalizedLevel = validLevels.includes(level) ? level : "log";

		if (this.logger) {
			this.logger[normalizedLevel](message);
		} else {
			console[normalizedLevel](message);
		}
	}

	// --- actual request execution ---
	async _request(command, ...params) {
		const maxAttempts = this.retryCount > 0 ? this.retryCount : 1;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			try {
				this.log(`Requesting ${command} from ${this.ip} (attempt ${attempt})`);
				const commandData = RainBirdClass.sipCommands.ControllerCommands[command];
				if (!commandData) throw new Error("Invalid command");

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
		const resultObj = RainBirdClass.sipCommands.ControllerResponses[resultCode];
		if (!resultObj) throw new Error("Response code not found");
		if (resultLength !== resultObj.length) throw new Error("Invalid response length");

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

	// --- static SIP command definitions ---
	static sipCommands = {
		ControllerCommands: {
			ModelAndVersionRequest: { command: "02", response: "82", length: 1 },
			AvailableStationsRequest: { command: "03", parameter: 0, response: "83", length: 2 },
			CommandSupportRequest: { command: "04", commandToTest: "02", response: "84", length: 2 },
			SerialNumberRequest: { command: "05", response: "85", length: 1 },
			CurrentTimeRequest: { command: "10", response: "90", length: 1 },
			CurrentDateRequest: { command: "12", response: "92", length: 1 },
			WaterBudgetRequest: { command: "30", parameter: 0, response: "B0", length: 2 },
			ZonesSeasonalAdjustFactorRequest: { command: "32", parameter: 0, response: "B2", length: 2 },
			CurrentRainSensorStateRequest: { command: "3E", response: "BE", length: 1 },
			CurrentStationsActiveRequest: { command: "3F", parameter: 0, response: "BF", length: 2 },
			ManuallyRunProgramRequest: { command: "38", parameter: 0, response: "01", length: 2 },
			ManuallyRunStationRequest: { command: "39", parameterOne: 0, parameterTwo: 0, response: "01", length: 4 },
			TestStationsRequest: { command: "3A", parameter: 0, response: "01", length: 2 },
			StopIrrigationRequest: { command: "40", response: "01", length: 1 },
			RainDelayGetRequest: { command: "36", response: "B6", length: 1 },
			RainDelaySetRequest: { command: "37", parameter: 0, response: "01", length: 3 },
			AdvanceStationRequest: { command: "42", parameter: 0, response: "01", length: 2 },
			CurrentIrrigationStateRequest: { command: "48", response: "C8", length: 1 },
			CurrentControllerStateSet: { command: "49", parameter: 0, response: "01", length: 2 },
			ControllerEventTimestampRequest: { command: "4A", parameter: 0, response: "CA", length: 2 },
			StackManuallyRunStationRequest: {
				command: "4B",
				parameter: 0,
				parameterTwo: 0,
				parameterThree: 0,
				response: "01",
				length: 4,
			},
			CombinedControllerStateRequest: { command: "4C", response: "CC", length: 1 },
		},
		ControllerResponses: {
			"00": {
				length: 3,
				type: "NotAcknowledgeResponse",
				commandEcho: { position: 2, length: 2 },
				NAKCode: { position: 4, length: 2 },
				f: (o) => (o.ack = false),
			},
			"01": {
				length: 2,
				type: "AcknowledgeResponse",
				commandEcho: { position: 2, length: 2 },
				f: (o) => (o.ack = true),
			},
			82: {
				length: 5,
				type: "ModelAndVersionResponse",
				modelID: { position: 2, length: 4 },
				protocolRevisionMajor: { position: 6, length: 2 },
				protocolRevisionMinor: { position: 8, length: 2 },
			},
			83: {
				length: 6,
				type: "AvailableStationsResponse",
				pageNumber: { position: 2, length: 2 },
				setStations: { position: 4, length: 8 },
			},
			84: {
				length: 3,
				type: "CommandSupportResponse",
				commandEcho: { position: 2, length: 2 },
				support: { position: 4, length: 2 },
			},
			85: { length: 9, type: "SerialNumberResponse", serialNumber: { position: 2, length: 16 } },
			90: {
				length: 4,
				type: "CurrentTimeResponse",
				hour: { position: 2, length: 2 },
				minute: { position: 4, length: 2 },
				second: { position: 6, length: 2 },
				f: (o) => {
					o.hour = parseInt(o.hour, 16);
					o.minute = parseInt(o.minute, 16);
					o.second = parseInt(o.second, 16);
				},
			},
			92: {
				length: 4,
				type: "CurrentDateResponse",
				day: { position: 2, length: 2 },
				month: { position: 4, length: 1 },
				year: { position: 5, length: 3 },
				f: (o) => {
					o.day = parseInt(o.day, 16);
					o.month = parseInt(o.month, 16);
					o.year = parseInt(o.year, 16);
				},
			},
			B0: {
				length: 4,
				type: "WaterBudgetResponse",
				programCode: { position: 2, length: 2 },
				seasonalAdjust: { position: 4, length: 4 },
			},
			B2: {
				length: 18,
				type: "ZonesSeasonalAdjustFactorResponse",
				programCode: { position: 2, length: 2 },
				stationsSA: { position: 4, length: 32 },
			},
			BE: {
				length: 2,
				type: "CurrentRainSensorStateResponse",
				sensorState: { position: 2, length: 2 },
				f: (o) => (o.sensorState = !!parseInt(o.sensorState, 16)),
			},
			BF: {
				length: 6,
				type: "CurrentStationsActiveResponse",
				pageNumber: { position: 2, length: 2 },
				activeStations: { position: 4, length: 8 },
				f: (o) => {
					o.activeZones = o.activeStations.match(/.{1,2}/g).map(
						(x) =>
							parseInt("0x" + x)
								.toString(2)
								.split("")
								.reverse()
								.join("")
								.indexOf("1") + 1
					);
				},
			},
			B6: {
				length: 3,
				type: "RainDelaySettingResponse",
				delaySetting: { position: 2, length: 4 },
				f: (o) => (o.delaySetting = parseInt(o.delaySetting, 16)),
			},
			C8: {
				length: 2,
				type: "CurrentIrrigationStateResponse",
				irrigationState: { position: 2, length: 2 },
				f: (o) => (o.irrigationState = !!parseInt(o.irrigationState, 16)),
			},
			CA: {
				length: 6,
				type: "ControllerEventTimestampResponse",
				eventId: { position: 2, length: 2 },
				timestamp: { position: 4, length: 8 },
			},
			CC: {
				length: 16,
				type: "CombinedControllerStateResponse",
				hour: { position: 2, length: 2 },
				minute: { position: 4, length: 2 },
				second: { position: 6, length: 2 },
				day: { position: 8, length: 2 },
				month: { position: 10, length: 1 },
				year: { position: 11, length: 3 },
				delaySetting: { position: 14, length: 4 },
				sensorState: { position: 18, length: 2 },
				irrigationState: { position: 20, length: 2 },
				seasonalAdjust: { position: 22, length: 4 },
				remainingRuntime: { position: 26, length: 4 },
				activeStation: { position: 30, length: 2 },
			},
		},
	};
}

module.exports = RainBirdClass;

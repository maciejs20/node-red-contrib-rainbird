// Device mapping data taken and adapted from:
// https://github.com/allenporter/pyrainbird/blob/main/pyrainbird
const RainBirdModels = require("./rainbird-models.js");

module.exports = function (RED) {
	function bitCount(n) {
		return n.toString(2).replace(/0/g, "").length;
	}

	function cleanType(obj) {
		if (obj && typeof obj === "object" && "_type" in obj) {
			delete obj._type;
		}
		return obj;
	}

	function decodeRainbirdDateTime(result) {
		//decode time/date and remove original objects
		if (result.time) {
			result.timeDecoded = {
				hour: parseInt(result.time.hour, 16),
				minute: parseInt(result.time.minute, 16),
				second: parseInt(result.time.second, 16),
			};
			delete result.time; // remove original raw hex object
		}
		if (result.date) {
			result.dateDecoded = {
				day: parseInt(result.date.day, 16),
				month: parseInt(result.date.month, 16),
				year: parseInt(result.date.year, 16), // already offset year
			};
			delete result.date; // remove original raw hex object
		}
		return result;
	}

	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting Rainbird LNK2 rainbird-info node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			this.status({ fill: "red", shape: "ring", text: "Invalid configuration" });
			return;
		}

		const node = this;
		const rainbird = this.server.getInstance();

		node.on("input", async (msg) => {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			try {
				const [serialNumber, modelAndVersion, time, date, availableZones, rainSensorState] = await Promise.all([
					rainbird.getSerialNumber(),
					rainbird.getModelAndVersion(),
					rainbird.getTime(),
					rainbird.getDate(),
					rainbird.getAvailableZones(),
					rainbird.getRainSensorState(),
				]);

				const result = {
					serialNumber: cleanType(serialNumber),
					modelAndVersion: cleanType(modelAndVersion),
					time: cleanType(time),
					date: cleanType(date),
					availableZones: cleanType(availableZones),
					rainSensorState: cleanType(rainSensorState),
				};

				if (result.availableZones?.setStations) {
					const num = parseInt(result.availableZones.setStations, 16);
					result.availableZones.stationsAvail = bitCount(num);
					delete result.availableZones.setStations;
				}

				const modelID = (result.modelAndVersion?.modelID || "").toLowerCase();
				const modelInfo = RainBirdModels[modelID] || RainBirdModels["UNKNOWN"];
				Object.assign(result.modelAndVersion, {
					modelCode: modelInfo.code,
					modelName: modelInfo.name,
					supportsWaterBudget: modelInfo.supports_water_budget,
					maxPrograms: modelInfo.max_programs,
					maxRunTimes: modelInfo.max_run_times,
					retries: modelInfo.retries || false,
				});

				node.log(`Fetching program water budget (max programs: ${result.modelAndVersion.maxPrograms})...`);
				const waterBudgetProgramsResults = await Promise.allSettled(
					Array.from({ length: result.modelAndVersion.maxPrograms }, (_, i) => rainbird.getWaterBudgetRequest(i))
				);

				const waterBudgetPrograms = waterBudgetProgramsResults.map((res, idx) => {
					if (res.status === "fulfilled") {
						const clean = cleanType(res.value);
						if (clean.seasonalAdjust) {
							const pct = parseInt(clean.seasonalAdjust, 16);
							if (!isNaN(pct)) {
								clean.waterBudgetPercent = pct;
								delete clean.seasonalAdjust; // remove original raw hex value
							}
						}
						return clean;
					} else {
						node.warn(`Program ${idx} failed: ${res.reason.message || res.reason}`);
						return { program: idx, error: res.reason.message || "unknown error" };
					}
				});

				result.programsWaterBudget = waterBudgetPrograms;

				// Decode hex time/date
				decodeRainbirdDateTime(result);

				msg.payload = result;
				node.send(msg);

				node.status({ fill: "green", shape: "dot", text: "OK" });
				if (this._statusTimer) clearTimeout(this._statusTimer);
				this._statusTimer = setTimeout(() => node.status({}), 5000);
			} catch (err) {
				node.error(`LNK2 Rainbird call error: ${err.message}`, msg);
				node.status({ fill: "red", shape: "ring", text: err.message });
			}
		});
	}

	RED.nodes.registerType("rainbird-info", RainbirdNode);
};

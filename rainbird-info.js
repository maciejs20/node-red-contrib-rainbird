const RainBirdClass = require("./node-rainbird.js");

// Device mapping data taken and adapted from:
// https://github.com/allenporter/pyrainbird/blob/main/pyrainbird
const RainBirdModels = {
	"0003": {
		code: "ESP_RZXe",
		name: "ESP-RZXe",
		supports_water_budget: false,
		max_programs: 0,
		max_run_times: 6,
		retries: true,
	},
	"0007": {
		code: "ESP_ME",
		name: "ESP-Me",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
		retries: true,
	},
	"0006": { code: "ST8X_WF", name: "ST8x-WiFi", supports_water_budget: false, max_programs: 0, max_run_times: 6 },
	"0005": { code: "ESP_TM2", name: "ESP-TM2", supports_water_budget: true, max_programs: 3, max_run_times: 4 },
	"0008": { code: "ST8X_WF2", name: "ST8x-WiFi2", supports_water_budget: false, max_programs: 8, max_run_times: 6 },
	"0009": {
		code: "ESP_ME3",
		name: "ESP-ME3",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
		retries: true,
	},
	"0010": {
		code: "MOCK_ESP_ME2",
		name: "ESP-Me2",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
		retries: true,
	},
	"000a": { code: "ESP_TM2v2", name: "ESP-TM2", supports_water_budget: true, max_programs: 3, max_run_times: 4 },
	"010a": { code: "ESP_TM2v3", name: "ESP-TM2", supports_water_budget: true, max_programs: 3, max_run_times: 4 },
	"0099": { code: "TBOS_BT", name: "TBOS-BT", supports_water_budget: true, max_programs: 3, max_run_times: 8 },
	"0100": { code: "TBOS_BT", name: "TBOS-BT", supports_water_budget: true, max_programs: 3, max_run_times: 8 },
	"0107": {
		code: "ESP_MEv2",
		name: "ESP-Me",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
		retries: true,
	},
	"0103": { code: "ESP_RZXe2", name: "ESP-RZXe2", supports_water_budget: false, max_programs: 8, max_run_times: 6 },
	"0812": { code: "RC2", name: "RC2", supports_water_budget: true, max_programs: 3, max_run_times: 4 },
	"0813": { code: "ARC8", name: "ARC8", supports_water_budget: true, max_programs: 3, max_run_times: 4 },
	UNKNOWN: {
		code: "UNKNOWN",
		name: "Unknown",
		supports_water_budget: false,
		max_programs: 0,
		max_run_times: 0,
		retries: false,
	},
};

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

	// Timeout helper
	function withTimeout(promise, ms) {
		const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms));
		return Promise.race([promise, timeout]);
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
		//const rainbird = new RainBirdClass();
		//this.server.configInstance(rainbird);
		const rainbird = this.server.getInstance();

		node.on("input", async (msg) => {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			try {
				const [serialNumber, 
                    modelAndVersion, 
                    time,
                    date, 
                    availableZones, 
                    rainSensorState,
                    //seasonalAdjust //this does not work, returns NAK for my ESP-ME3
                ] =
					await Promise.all([
						rainbird.getSerialNumber(),
						rainbird.getModelAndVersion(),
						rainbird.getTime(),
						rainbird.getDate(),
						rainbird.getAvailableZones(),
						rainbird.getRainSensorState(),
						//rainbird.getSeasonalAdjust(0), //this does not work, returns NAK for my ESP-ME3
					]);

				const result = {
					serialNumber: cleanType(serialNumber),
					modelAndVersion: cleanType(modelAndVersion),
					time: cleanType(time),
					date: cleanType(date),
					availableZones: cleanType(availableZones),
					rainSensorState: cleanType(rainSensorState),
					//seasonalAdjust: cleanType(seasonalAdjust), //this does not work, returns NAK for my ESP-ME3
				};

				if (result.availableZones?.setStations) {
					const num = parseInt(result.availableZones.setStations, 16);
					result.availableZones.stationsAvail = bitCount(num);
					delete result.availableZones.setStations;
				}

				const modelID = result.modelAndVersion?.modelID;
				const modelInfo = RainBirdModels[modelID] || RainBirdModels["UNKNOWN"];
				Object.assign(result.modelAndVersion, {
					modelCode: modelInfo.code,
					modelName: modelInfo.name,
					supportsWaterBudget: modelInfo.supports_water_budget,
					maxPrograms: modelInfo.max_programs,
					maxRunTimes: modelInfo.max_run_times,
					retries: modelInfo.retries || false,
				});

				// Retrieve program water budget (timeout handled by RainBirdClass itself)
				node.log(`Fetching program water budget (max programs: ${result.modelAndVersion.maxPrograms})...`);
				const waterBudgetProgramsResults = await Promise.allSettled(
					Array.from({ length: result.modelAndVersion.maxPrograms }, (_, i) => {
						// node.log(`Calling getWaterBudgetRequest(${i})`);
						return rainbird.getWaterBudgetRequest(i).catch((err) => {
							node.warn(`Error in program ${i}: ${err.message}`);
							throw new Error(`Program ${i}: ${err.message}`);
						});
					})
				);

				const waterBudgetPrograms = waterBudgetProgramsResults.map((res, idx) => {
					if (res.status === "fulfilled") {
						const clean = cleanType(res.value);

						// Convert seasonalAdjust hex value to numeric percentage
						if (clean.seasonalAdjust) {
							clean.waterBudgetPercent = parseInt(clean.seasonalAdjust, 16);
						}

						return clean;
					} else {
						node.warn(`Program ${idx} failed: ${res.reason.message || res.reason}`);
						return { program: idx, error: res.reason.message || "unknown error" };
					}
				});

				result.programsWaterBudget = waterBudgetPrograms;

				msg.payload = result;

				node.send(msg);
				node.status({ fill: "green", shape: "dot", text: "OK" });
				const timeout = setTimeout(() => node.status({}), 5000);
				node.on("close", () => clearTimeout(timeout));
			} catch (err) {
				node.error(`LNK2 Rainbird call error: ${err.message}`, msg);
				node.status({ fill: "red", shape: "ring", text: err.message });
			}
		});
	}

	RED.nodes.registerType("rainbird-info", RainbirdNode);
};

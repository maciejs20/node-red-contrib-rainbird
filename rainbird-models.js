// rainbird-models.js
// Device mapping data taken and adapted from:
// https://github.com/allenporter/pyrainbird/blob/main/pyrainbird

module.exports = {
	"0003": {
		code: "ESP_RZXe",
		name: "ESP-RZXe",
		supports_water_budget: false,
		max_programs: 0,
		max_run_times: 6,
	},
	"0007": {
		code: "ESP_ME",
		name: "ESP-Me",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
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
	},
	"0010": {
		code: "MOCK_ESP_ME2",
		name: "ESP-Me2",
		supports_water_budget: true,
		max_programs: 4,
		max_run_times: 6,
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
	},
};

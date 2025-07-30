/**
 * Rainbird SIP Commands and Responses
 * Extracted from pyrainbird and node-rainbird sources.
 * Some commands are not implemented yet in RainBirdClass methods.
 */

const sipCommands = {
	ControllerCommands: {
		ModelAndVersionRequest: { command: "02", response: "82", length: 1 },
		AvailableStationsRequest: { command: "03", parameter: 0, response: "83", length: 2 },
		CommandSupportRequest: { command: "04", parameter: "02", response: "84", length: 2 },
		SerialNumberRequest: { command: "05", response: "85", length: 1 },
		ControllerFirmwareVersionRequest: { command: "0B", response: "8B", length: 1 }, // not implemented yet
		CurrentTimeRequest: { command: "10", response: "90", length: 1 },
		SetCurrentTimeRequest: { command: "11", response: "01", length: 4 }, // not implemented yet
		CurrentDateRequest: { command: "12", response: "92", length: 1 },
		SetCurrentDateRequest: { command: "13", response: "01", length: 4 }, // not implemented yet
		RetrieveScheduleRequest: { command: "20", parameter: 0, response: "A0", length: 3 },
		WaterBudgetRequest: { command: "30", parameter: 0, response: "B0", length: 2 },
		ZonesSeasonalAdjustFactorRequest: { command: "32", parameter: 0, response: "B2", length: 2 },
		RainDelayGetRequest: { command: "36", response: "B6", length: 1 },
		RainDelaySetRequest: { command: "37", parameter: 0, response: "01", length: 3 },
		ManuallyRunProgramRequest: { command: "38", parameter: 0, response: "01", length: 2 },
		ManuallyRunStationRequest: { command: "39", parameterOne: 0, parameterTwo: 0, response: "01", length: 4 },
		TestStationsRequest: { command: "3A", parameter: 0, response: "01", length: 2 },
		CurrentQueueRequest: { command: "3B", response: "BB", length: 2 }, // not implemented yet
		CurrentRainSensorStateRequest: { command: "3E", response: "BE", length: 1 },
		CurrentStationsActiveRequest: { command: "3F", parameter: 0, response: "BF", length: 2 },
		StopIrrigationRequest: { command: "40", response: "01", length: 1 },
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
		StartLearnFlowSequenceRequest: { command: "60", response: "E0", length: 1 }, // not implemented yet
		CancelLearnFlowSequenceRequest: { command: "61", response: "E0", length: 1 }, // not implemented yet
		LearnFlowSequenceStatusRequest: { command: "62", response: "E2", length: 1 }, // not implemented yet
		FlowMonitorStatusRequest: { command: "63", response: "E3", length: 1 }, // not implemented yet
		FlowMonitorStatusSetRequest: { command: "64", response: "64", length: 1 }, // not implemented yet
		FlowMonitorRateRequest: { command: "65", response: "E5", length: 1 }, // not implemented yet
	},

	ControllerResponses: {
		"00": {
			// NotAcknowledgeResponse
			type: "NotAcknowledgeResponse",
			length: 3,
			commandEcho: { position: 2, length: 2 },
			NAKCode: { position: 4, length: 2 },
		},
		"01": {
			// AcknowledgeResponse
			type: "AcknowledgeResponse",
			length: 2,
			commandEcho: { position: 2, length: 2 },
		},
		82: {
			// ModelAndVersionResponse
			type: "ModelAndVersionResponse",
			length: 5,
			modelID: { position: 2, length: 4 },
			protocolRevisionMajor: { position: 6, length: 2 },
			protocolRevisionMinor: { position: 8, length: 2 },
		},
		83: {
			// AvailableStationsResponse
			type: "AvailableStationsResponse",
			length: 6,
			pageNumber: { position: 2, length: 2 },
			setStations: { position: 4, length: 8 },
		},
		84: {
			// CommandSupportResponse
			type: "CommandSupportResponse",
			length: 3,
			commandEcho: { position: 2, length: 2 },
			support: { position: 4, length: 2 },
		},
		85: {
			// SerialNumberResponse
			type: "SerialNumberResponse",
			length: 9,
			serialNumber: { position: 2, length: 16 },
		},
		"8B": {
			// ControllerFirmwareVersionResponse
			type: "ControllerFirmwareVersionResponse",
			length: 5,
			major: { position: 2, length: 2 },
			minor: { position: 4, length: 2 },
			patch: { position: 6, length: 4 },
		},
		90: {
			// CurrentTimeResponse
			type: "CurrentTimeResponse",
			length: 4,
			hour: { position: 2, length: 2 },
			minute: { position: 4, length: 2 },
			second: { position: 6, length: 2 },
		},
		92: {
			// CurrentDateResponse
			type: "CurrentDateResponse",
			length: 4,
			day: { position: 2, length: 2 },
			month: { position: 4, length: 1 },
			year: { position: 5, length: 3 },
		},
		A0: {
			// RetrieveScheduleResponse
			type: "RetrieveScheduleResponse",
			decoder: "decode_schedule",
		},
		B0: {
			// WaterBudgetResponse
			type: "WaterBudgetResponse",
			length: 4,
			programCode: { position: 2, length: 2 },
			seasonalAdjust: { position: 4, length: 4 },
		},
		B2: {
			// ZonesSeasonalAdjustFactorResponse
			type: "ZonesSeasonalAdjustFactorResponse",
			length: 18,
			programCode: { position: 2, length: 2 },
			stationsSA: { position: 4, length: 32 },
		},
		B6: {
			// RainDelaySettingResponse
			type: "RainDelaySettingResponse",
			length: 3,
			delaySetting: { position: 2, length: 4 },
		},
		BB: {
			// CurrentQueueResponse
			type: "CurrentQueueResponse",
			decoder: "decode_queue",
		},
		BE: {
			// CurrentRainSensorStateResponse
			type: "CurrentRainSensorStateResponse",
			length: 2,
			sensorState: { position: 2, length: 2 },
		},
		BF: {
			// CurrentStationsActiveResponse
			type: "CurrentStationsActiveResponse",
			length: 6,
			pageNumber: { position: 2, length: 2 },
			activeStations: { position: 4, length: 8 },
		},
		C8: {
			// CurrentIrrigationStateResponse
			type: "CurrentIrrigationStateResponse",
			length: 2,
			irrigationState: { position: 2, length: 2 },
		},
		CA: {
			// ControllerEventTimestampResponse
			type: "ControllerEventTimestampResponse",
			length: 6,
			eventId: { position: 2, length: 2 },
			timestamp: { position: 4, length: 8 },
		},
		CC: {
			// CombinedControllerStateResponse
			type: "CombinedControllerStateResponse",
			length: 16,
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

module.exports = sipCommands;

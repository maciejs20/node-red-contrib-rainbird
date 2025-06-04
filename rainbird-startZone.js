const zoneDurations = {}; // Stores per-zone default durations (zoneId => minutes)
const MAX_ZONES = 22;
const MAX_TIME = 60;

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;

		node.name = config.name;
		node.defaultDuration = parseInt(config.duration) || 10;
		node.server = RED.nodes.getNode(config.server);

		if (!node.server || !node.server.rainIp || !node.server.rainKey) {
			node.error("Server configuration is missing or invalid.");
			return;
		}

		const rainbird = node.server.getInstance();

		node.on("input", function (msg) {
			if (msg.hasOwnProperty("hap")) {
				delete msg.hap;
			}
			// node.debug("Incoming message: " + JSON.stringify(msg));

			const topic = String(msg.topic ?? "");

			// --- Handle SetDuration messages (from HomeKit etc.) ---
			if (msg.payload?.SetDuration && topic) {
				const durationMin = Math.floor(msg.payload.SetDuration / 60);
				if (durationMin >= 1 && durationMin <= MAX_TIME) {
					zoneDurations[topic] = durationMin;
					node.log(`SetDuration received for zone ${topic}: ${durationMin} minutes`);
				} else {
					node.warn(`Invalid SetDuration for zone ${topic}: ${durationMin} minutes`);
				}
				return;
			}

			// --- Ignore if payload.Active is missing ---
			if (!msg.payload || typeof msg.payload.Active === "undefined") {
				node.debug("Ignored message without payload.Active.");
				return;
			}

			// --- Ignore Active = 0 ---
			if (msg.payload.Active === 0) {
				node.debug("Active = 0 received – doing nothing (ignored).");
				return;
			}

			// --- Determine zone and duration ---
			const zone = parseInt(topic);
			let duration = parseInt(msg.time);
			if (isNaN(duration)) {
				duration = zoneDurations[topic] ?? node.defaultDuration;
			}

			if (isNaN(zone) || zone < 1 || zone > MAX_ZONES) {
				node.error(`Invalid or missing zone number. Must be between 1 and ${MAX_ZONES}.`);
				return;
			}

			if (isNaN(duration) || duration < 1 || duration > MAX_TIME) {
				node.error(`Invalid watering time: ${duration}. Must be between 1 and ${MAX_TIME} minutes.`);
				return;
			}

			// --- Log action with timestamp ---
			const now = new Date().toISOString();
			node.log(`Triggering watering: node "${node.name || "(unnamed)"}", zone ${zone}, duration ${duration}min`);

			// --- Execute watering ---
			node.status({ fill: "yellow", shape: "dot", text: `Activating zone ${zone}...` });

			rainbird
				.startZone(zone, duration)
				.then((result) => {
					node.status({ fill: "green", shape: "dot", text: `Zone ${zone} started` });
					msg.payload = result;
					node.send(msg);
					setTimeout(() => node.status({}), 5000);
				})
				.catch((error) => {
					node.error("Error starting zone: " + error.message);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}

	RED.nodes.registerType("rainbird-startZone", RainbirdNode);
};

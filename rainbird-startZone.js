const zoneDurations = {};
const MAX_ZONES = 22;  //maximum number of zones this supports
const MAX_TIME = 60;  //max irrigation time allowed
const GLOBAL_COMMAND_DELAY_MS = 300; //delay between consecutive start commands, may be required if You have main valve or pump
const MAX_GLOBAL_QUEUE_LENGTH = 3; //max queue length for consecutive start commands

const globalQueue = [];
let isProcessing = false;

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

		function enqueueGlobalCommand(commandFn) {
			if (globalQueue.length >= MAX_GLOBAL_QUEUE_LENGTH) {
				node.warn(`Global command queue full. Dropping command.`);
				return;
			}

			globalQueue.push(commandFn);

			if (!isProcessing) {
				processGlobalQueue();
			}
		}

		function processGlobalQueue() {
			if (globalQueue.length === 0) {
				isProcessing = false;
				return;
			}

			isProcessing = true;
			const next = globalQueue.shift();

			next()
				.catch((err) => {
					node.error(`Command execution error: ${err.message}`);
					node.status({ fill: "red", shape: "ring", text: `Error: ${err.message}` });
					setTimeout(() => node.status({}), 5000);
				})
				.finally(() => {
					setTimeout(() => processGlobalQueue(), GLOBAL_COMMAND_DELAY_MS);
				});
		}

		node.on("input", function (msg) {
			if (msg.hasOwnProperty("hap")) {
				delete msg.hap;
			}

			const topic = String(msg.topic ?? "");

			// HomeKit duration update
			if (msg.payload?.SetDuration && topic) {
				const durationMin = Math.floor(msg.payload.SetDuration / 60);
				if (durationMin >= 1 && durationMin <= MAX_TIME) {
					zoneDurations[topic] = durationMin;
					node.log(`SetDuration for zone ${topic}: ${durationMin} minutes`);
				} else {
					node.warn(`Invalid SetDuration for ${topic}: ${durationMin} minutes`);
				}
				return;
			}

			if (!msg.payload || typeof msg.payload.Active === "undefined") {
				node.debug("Ignored message without payload.Active");
				return;
			}

			if (msg.payload.Active === 0) {
				node.debug("Active = 0 received – doing nothing.");
				return;
			}

			const zone = parseInt(topic);
			let duration = parseInt(msg.time);
			if (isNaN(duration)) {
				duration = zoneDurations[topic] ?? node.defaultDuration;
			}

			if (isNaN(zone) || zone < 1 || zone > MAX_ZONES) {
				node.error(`Invalid zone number: ${zone}`);
				return;
			}

			if (isNaN(duration) || duration < 1 || duration > MAX_TIME) {
				node.error(`Invalid watering time: ${duration}`);
				return;
			}

			const command = async () => {
				node.log(`Starting zone ${zone} for ${duration} minutes...`);
				node.status({ fill: "yellow", shape: "dot", text: `Zone ${zone} starting...` });

				const result = await rainbird.startZone(zone, duration);

				node.status({ fill: "green", shape: "dot", text: `Zone ${zone} started` });
				msg.payload = result;
				node.send(msg);

				setTimeout(() => node.status({}), 5000);
			};

			enqueueGlobalCommand(command);
		});
	}

	RED.nodes.registerType("rainbird-startZone", RainbirdNode);
};

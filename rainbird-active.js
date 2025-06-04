const RainBirdClass = require("./node-rainbird.js");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;

		node.log("Starting rainbird LNK2 rainbird-active node.");

		this.server = RED.nodes.getNode(config.server);
		this.mode = config.mode || "raw";
		this.prevState = []; // lokalny stan stref
		this.name = config.name;

		const MAX_INACTIVITY_SECONDS = 1800; // 30 minut
		const FULL_UPDATE_EVERY_N_MESSAGES = 10; // co 10 komunikatów pełna informacja
		let lastFullUpdateTime = 0;
		let messageCounter = 0;

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		const rainbird = this.server.getInstance();

		node.on("input", function (msg) {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			rainbird
				.getActiveZones()
				.then((result) => {
					node.status({ fill: "green", shape: "dot", text: "OK" });

					if (node.mode === "homekit") {
						const now = Date.now();
						messageCounter++;
						const timeExceeded = now - lastFullUpdateTime > MAX_INACTIVITY_SECONDS * 1000;
						const counterExceeded = messageCounter % FULL_UPDATE_EVERY_N_MESSAGES === 0;
						const forceFullUpdate = timeExceeded || counterExceeded;

						const { changed, fullState, newState } = processHomekitMode(result, node.prevState, forceFullUpdate);
						node.prevState = newState;

						if (forceFullUpdate || changed.length > 0) {
							if (forceFullUpdate) {
								const reason = timeExceeded
									? `no change for ${MAX_INACTIVITY_SECONDS} seconds`
									: `${FULL_UPDATE_EVERY_N_MESSAGES} messages`;
								node.log(`Sending full update (${reason}).`);
								lastFullUpdateTime = now;
							}
							const toSend = forceFullUpdate ? fullState : changed;
							toSend.forEach((msgItem) => node.send(msgItem));
						}

						setTimeout(() => node.status({}), 5000);
						return;
					}

					// RAW mode
					const payload = { ...result };
					delete payload._type;
					msg.payload = payload;
					node.send(msg);

					setTimeout(() => node.status({}), 5000);
				})
				.catch((err) => {
					node.error("LNK2 Rainbird call error: " + err);
					node.status({ fill: "red", shape: "ring", text: "Error" });
				});
		});
	}

	RED.nodes.registerType("rainbird-active", RainbirdNode);

	function processHomekitMode(result, prevState = [], forceFullUpdate = false) {
		const maxSprinklers = 6;
		const sprinkler = parseInt(result.activeZones?.[0]) || 0;
		const out = [];

		for (let i = 0; i < maxSprinklers; i++) {
			out.push({
				payload: {
					Active: 0,
					InUse: 0,
				},
				topic: (i + 1).toString(),
			});
		}

		if (sprinkler > 0 && sprinkler <= maxSprinklers) {
			out[sprinkler - 1] = {
				payload: {
					Active: 1,
					InUse: 1,
				},
				topic: sprinkler.toString(),
			};
		}

		const changed = [];

		out.forEach((item, index) => {
			const prevItem = prevState[index];
			if (prevItem?.payload?.Active !== item.payload.Active) {
				changed.push(item);
			}
		});

		return {
			changed,
			fullState: out,
			newState: out,
		};
	}
};

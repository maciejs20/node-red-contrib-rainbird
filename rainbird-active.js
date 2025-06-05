

module.exports = function (RED) {
	const MAX_SPRINKLERS = 6; // max number of zones in homekit mode. tested up to 8

	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;
		
		node.log("Starting rainbird LNK2 rainbird-active node.");

		this.server = RED.nodes.getNode(config.server);
		this.mode = config.mode || "raw";
		this.name = config.name;

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		// auto-refresh when zone started/closed
		this.server.registerOnZoneStart((zoneId, duration) => {
			node.debug(`Zone ${zoneId} started. Forcing update.`);
			setTimeout(() => node.emit("input", {}), 600);
			setTimeout(() => node.emit("input", {}), 2000);
		});

		const rainbird = this.server.getInstance();

		node.on("input", function (msg) {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			rainbird
				.getActiveZones()
				.then((result) => {
					node.status({ fill: "green", shape: "dot", text: "OK" });

					if (node.mode === "homekit") {
						const fullState = processHomekitMode(result);
						node.log("Sending full state update (homekit mode).");
						fullState.forEach((msgItem) => node.send(msgItem));
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
					node.error("LNK2 Rainbird call error: " + err.message);
					node.status({ fill: "red", shape: "ring", text: "Error" });
				});
		});
	}

	RED.nodes.registerType("rainbird-active", RainbirdNode);

	function processHomekitMode(result) {
		const maxSprinklers = MAX_SPRINKLERS;
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

		return out;
	}
};

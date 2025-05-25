const RainBirdClass = require("node-rainbird");

module.exports = function (RED) {
	function bitCount(n) {
		// Returns the number of 1s in the binary representation of n
		n = n - ((n >> 1) & 0x55555555);
		n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
		return (((n + (n >> 4)) & 0xf0f0f0f) * 0x1010101) >> 24;
	}

	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-info node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		var rainbird = new RainBirdClass(this.server.rainIp, this.server.rainKey);

		node.on("input", function (msg) {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			Promise.all([
				rainbird.getSerialNumber(),
				rainbird.getModelAndVersion(),
				rainbird.getTime(),
				rainbird.getDate(),
				rainbird.getAvailableZones(),
			])
				.then((result) => {
					node.status({ fill: "green", shape: "dot", text: "OK" });

					const merged = Object.assign({}, ...result);
					delete merged._type;
					if (merged.hasOwnProperty("setStations")) {
						var num = parseInt(merged.setStations, 16);
						merged.stationsAvail = bitCount(num);
						delete merged.setStations;
					}

					msg.payload = merged;
					node.send(msg);
					
					// Clear status after 5 seconds
					setTimeout(() => {
						node.status({});
					}, 5000);
				})
				.catch((err) => {
					node.error("LNK2 Rainbird call error: " + err.message);
					node.status({ fill: "red", shape: "ring", text: err.message });
				});
		});
	}
	RED.nodes.registerType("rainbird-info", RainbirdNode);
};

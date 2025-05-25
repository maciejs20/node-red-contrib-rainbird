const RainBirdClass = require("node-rainbird");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-active node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		var rainbird = new RainBirdClass(this.server.rainIp, this.server.rainKey);

		node.on("input", function (msg) {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			rainbird
				.getActiveZones()
				.then((result) => {
					node.status({ fill: "green", shape: "dot", text: "OK" });
					const merged = Object.assign({}, result);
					delete merged._type;
					msg.payload = merged;
					node.send(msg);

					// Clear status after 5 seconds
					setTimeout(() => {
						node.status({});
					}, 5000);
				})
				.catch((err) => {
					node.error("LNK2 Rainbird call error: " + err.message);
					node.status({ fill: "red", shape: "ring", text: "Error" });
				});
		});
	}
	RED.nodes.registerType("rainbird-active", RainbirdNode);
};

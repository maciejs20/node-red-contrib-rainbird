const RainBirdClass = require("./node-rainbird.js");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-stopZone node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		const rainbird = this.server.getInstance();

		node.on("input", function (msg) {
			// Assuming node.status() is valid; replace with appropriate status handling logic if necessary
			node.status({ fill: "yellow", shape: "dot", text: "Query..." });

			rainbird
				.stopIrrigation()
				.then(function (result) {
					node.status({ fill: "green", shape: "dot", text: "OK" });
					msg.payload = result;
					node.send(msg);
					node.server.triggerZoneStart("all", 0);

					// Clear status after 5 seconds
					setTimeout(() => {
						node.status({});
					}, 5000);
				})
				.catch(function (error) {
					node.error("Error stopping irrigation: " + error.message);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-stopZone", RainbirdNode);
};

const RainBirdClass = require("node-rainbird");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-startZone node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		var rainbird = new RainBirdClass(this.server.rainIp, this.server.rainKey);

		node.on("input", function (msg) {
			if (msg.zone === "" || msg.zone === undefined) {
				node.error("No msg.zone provided");
				return;
			}
			if (msg.time === "" || msg.time === undefined) {
				node.error("No msg.time provided");
				return;
			}

			var zone = parseInt(msg.zone);
			var minutes = parseInt(msg.time);

			if (zone < 1 || zone > 22) {
				node.error("Wrong zone number in msg.zone.");
				return;
			}

			if (minutes < 1 || minutes > 60) {
				node.error("Wrong time in msg.time.");
				return;
			}

			// Assuming node.status() is valid; replace with appropriate status handling logic if necessary
			node.status({ fill: "yellow", shape: "dot", text: "Query..." });

			rainbird
				.startZone(zone, minutes)
				.then(function (result) {
					node.status({ fill: "green", shape: "dot", text: "OK" });
					msg.payload = result;
					node.send(msg);
					// Clear status after 5 seconds
					setTimeout(() => {
						node.status({});
					}, 5000);
				})
				.catch(function (error) {
					node.error("Error starting zone: " + error.message);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-startZone", RainbirdNode);
};

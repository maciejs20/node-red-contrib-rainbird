const RainBirdClass = require("./node-rainbird.js");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-startProgram node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		const rainbird = this.server.getInstance();

		node.on("input", function (msg) {
			//check msg.payload to be a number between 1 and 14
			if (typeof msg.payload === "number") {
				if (msg.payload >= 1 && msg.payload <= 14) {
					node.status({ fill: "yellow", shape: "dot", text: "Query..." });

					rainbird
						.startProgram(msg.payload)
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
							node.error("Error starting a program: " + error.message);
							node.status({ fill: "red", shape: "ring", text: "Failed" });
						});
				} else {
					node.error("Invalid payload: Number out of range.");
					node.status({ fill: "red", shape: "dot", text: "Payload out of range" });
				}
			} else {
				node.error("Invalid payload: Not a number.");
				node.status({ fill: "red", shape: "dot", text: "Payload not a number" });
			}
		});
	}
	RED.nodes.registerType("rainbird-startProgram", RainbirdNode);
};

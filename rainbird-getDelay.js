const RainBirdClass = require("./node-rainbird.js");

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("Starting rainbird LNK2 rainbird-getDelay node.");
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			this.error("Server configuration is missing or invalid.");
			return;
		}

		var node = this;
		const rainbird = this.server.getInstance();

		node.on("input", function (msg) {
			rainbird
				.getRainDelay()
				.then(function (result) {
					node.status({ fill: "green", shape: "dot", text: "OK" });
					delete result._type;
					msg.payload = result;
					node.send(msg);
					// Clear status after 5 seconds
					setTimeout(() => {
						node.status({});
					}, 5000);
				})
				.catch(function (error) {
					node.error("Error getting delay execution info: " + error.message);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-getDelay", RainbirdNode);
};

module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		const node = this;

		node.log("Starting rainbird LNK2 rainbird-state node.");

		this.server = RED.nodes.getNode(config.server);
		// Ensure server exists and has necessary properties
		if (!this.server || !this.server.rainIp || !this.server.rainKey) {
			node.error("Missing or invalid server configuration.");
			return;
		}

		const rainbird = this.server.getInstance();


		// === Main Logic ===
		node.on("input", function (msg) {
			node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

			rainbird
				.getIrrigationState()
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
				.catch(function (err) {
					node.error("LNK2 Rainbird call error: " + err.message);
					node.status({ fill: "red", shape: "ring", text: err.message });
				});
		});
	}

	RED.nodes.registerType("rainbird-state", RainbirdNode);
};

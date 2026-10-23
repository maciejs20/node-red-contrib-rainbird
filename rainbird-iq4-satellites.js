module.exports = function (RED) {
	/**
	 * Lists all controllers (satellites) registered on the IQ4 cloud account,
	 * so the user can discover the numeric satelliteId to configure on the
	 * other cloud nodes. No satelliteId input is required.
	 *
	 * Output payload: array of satellite objects (id, name, ...).
	 */
	function RainbirdIQ4SatellitesNode(config) {
		RED.nodes.createNode(this, config);
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.email) {
			this.error("IQ4 server configuration is missing or invalid.");
			return;
		}

		var node = this;
		const client = this.server.getClient();

		node.on("input", function (msg) {
			node.status({ fill: "blue", shape: "dot", text: "Loading" });
			client
				.getSatellites()
				.then(function (satellites) {
					msg.payload = satellites;
					node.send(msg);
					const count = Array.isArray(satellites) ? satellites.length : 0;
					node.status({ fill: "green", shape: "dot", text: count + " found" });
					setTimeout(() => node.status({}), 5000);
				})
				.catch(function (error) {
					node.error("IQ4 satellites read failed: " + error.message, msg);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-iq4-satellites", RainbirdIQ4SatellitesNode);
};

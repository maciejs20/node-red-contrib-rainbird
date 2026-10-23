module.exports = function (RED) {
	/**
	 * Reads the full program configuration from the IQ4 cloud, including
	 * seasonal adjust and per-station assigned runtimes. The local LNK2/SIP
	 * protocol only exposes a subset of this.
	 *
	 * Output payload: { programs, assignedRuntime }
	 */
	function RainbirdIQ4ProgramsNode(config) {
		RED.nodes.createNode(this, config);
		this.server = RED.nodes.getNode(config.server);

		if (!this.server || !this.server.email) {
			this.error("IQ4 server configuration is missing or invalid.");
			return;
		}

		var node = this;
		const client = this.server.getClient();

		node.on("input", function (msg) {
			const satelliteId = msg.satelliteId || node.server.satelliteId;
			if (!satelliteId) {
				node.error("IQ4: no satelliteId configured", msg);
				node.status({ fill: "red", shape: "ring", text: "No satelliteId" });
				return;
			}

			node.status({ fill: "blue", shape: "dot", text: "Loading" });
			Promise.all([
				client.getProgramList(satelliteId),
				client.getProgramsAssignedRuntime(satelliteId)
			])
				.then(function (results) {
					msg.payload = {
						programs: results[0],
						assignedRuntime: results[1]
					};
					node.send(msg);
					node.status({ fill: "green", shape: "dot", text: "OK" });
					setTimeout(() => node.status({}), 5000);
				})
				.catch(function (error) {
					node.error("IQ4 programs read failed: " + error.message, msg);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-iq4-programs", RainbirdIQ4ProgramsNode);
};

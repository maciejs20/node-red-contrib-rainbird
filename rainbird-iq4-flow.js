module.exports = function (RED) {
	/**
	 * Reads flow monitoring data from the IQ4 cloud. This information is not
	 * reliably available through the local LNK2/SIP protocol.
	 *
	 * Output payload: { flowMonitoring, flowElements }
	 */
	function RainbirdIQ4FlowNode(config) {
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
			// FlowMonitoring is documented but not confirmed on all firmwares;
			// don't let it fail the (confirmed) flow elements read.
			Promise.allSettled([
				client.getFlowElements(satelliteId),
				client.getFlowMonitoring(satelliteId)
			])
				.then(function (results) {
					if (results[0].status === "rejected") {
						throw results[0].reason;
					}
					msg.payload = {
						flowElements: results[0].value,
						flowMonitoring:
							results[1].status === "fulfilled" ? results[1].value : null
					};
					node.send(msg);
					node.status({ fill: "green", shape: "dot", text: "OK" });
					setTimeout(() => node.status({}), 5000);
				})
				.catch(function (error) {
					node.error("IQ4 flow read failed: " + error.message, msg);
					node.status({ fill: "red", shape: "ring", text: "Failed" });
				});
		});
	}
	RED.nodes.registerType("rainbird-iq4-flow", RainbirdIQ4FlowNode);
};

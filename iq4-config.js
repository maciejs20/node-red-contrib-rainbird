const RainbirdIQ4Client = require("./rainbird-iq4-client.js");
const crypto = require("crypto");

module.exports = function (RED) {
	/**
	 * Stores IQ4 cloud connection data and owns a single shared client
	 * instance (so one login/token is reused by all cloud nodes).
	 */
	function RainbirdIQ4ConfigNode(n) {
		RED.nodes.createNode(this, n);

		this.sname = n.sname;
		this.email = n.email;
		this.satelliteId = parseInt(n.satelliteId, 10);
		// APP_CLIENT_ID: generated once and persisted with the config node,
		// mirroring the official app (UUID.randomUUID() stored in preferences).
		this.clientId = n.clientId || crypto.randomUUID();
		this.debug = n.debug;

		var node = this;

		this.client = new RainbirdIQ4Client();
		this.client.setCredentials(this.email, this.credentials && this.credentials.password);
		this.client.setClientId(this.clientId);
		// Optional manual bearer token (bypasses the WAF-protected login).
		this.client.setManualToken(this.credentials && this.credentials.accessToken);
		// Optional aws-waf-token cookie (lets automated login pass the WAF).
		this.client.setWafToken(this.credentials && this.credentials.wafToken);
		this.client.setLogger({
			log: node.debug ? node.log.bind(node) : function () {},
			warn: node.warn.bind(node),
			error: node.error.bind(node)
		});

		this.getClient = function () {
			return this.client;
		};

		node.log("Rainbird IQ4 config: init cloud client satelliteId=" + this.satelliteId);

		node.on("close", function (done) {
			node.client.destroy();
			done();
		});
	}

	RED.nodes.registerType("rainbird-iq4-server", RainbirdIQ4ConfigNode, {
		credentials: {
			password: { type: "password" },
			accessToken: { type: "password" },
			wafToken: { type: "password" }
		}
	});
};

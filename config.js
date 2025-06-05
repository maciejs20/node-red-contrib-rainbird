const RainBirdClass = require("./node-rainbird.js");

module.exports = function (RED) {
	/**
	 * Save connection data
	 */

	function RemoteServerNode(n) {
		RED.nodes.createNode(this, n);

		this.rainIp = n.rainIp;
		this.rainKey = n.rainKey;
		this.rainDuration = 5; // default manual irrigation time
		this.retryCount = parseInt(n.retryCount, 10) || 2;
		this.timeout = parseInt(n.timeout, 10) || 3000;
		this.retryDelay = parseInt(n.retryDelay, 10) || 1000;
		this.debug = n.debug;

		//calbacks to update current status
		this.onZoneStartCallbacks = [];
		this.registerOnZoneStart = function (fn) {
			this.onZoneStartCallbacks.push(fn);
		};
		this.triggerZoneStart = function (zoneId, duration) {
			this.onZoneStartCallbacks.forEach((fn) => fn(zoneId, duration));
		};

		this.rainbirdInstance = new RainBirdClass();

		var node = this;

		this.configInstance = function (rbInstance) {
			if (!rbInstance || typeof rbInstance.setIp !== "function") {
				node.error("Invalid RainBird instance provided.");
				return;
			}

			rbInstance.setIp(this.rainIp);
			rbInstance.setPassword(this.rainKey);
			rbInstance.setRetryCount(this.retryCount);
			rbInstance.setRetryDelay(this.retryDelay);
			rbInstance.setTimeout(this.timeout);
			if (this.debug) {
				node.log("RainBird debug is on");
				rbInstance.setDebug(true);
			}

			rbInstance.setLogger({
				log: node.log.bind(node),
				warn: node.warn.bind(node),
				error: node.error.bind(node),
			});
		};

		this.configInstance(this.rainbirdInstance); // Skonfiguruj od razu

		this.getInstance = function () {
			// return RainBirdClass instance
			return this.rainbirdInstance;
		};

		node.log("Rainbird config: Init LNK2 ip=" + this.rainIp);
	}

	RED.nodes.registerType("rainbird-server", RemoteServerNode);
};

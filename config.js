module.exports = function (RED) {
	/**
	 * Save connection data
	 */

	function RemoteServerNode(n) {
		RED.nodes.createNode(this, n);
		this.rainIp = n.rainIp;
		this.rainKey = n.rainKey;
		this.rainDuration = 5; // default manual irrigation time
		var node = this;

		node.log("[config.js:RemoteServerNode] Rainbird config: Init lnk2 ip=" + this.rainIp);
	}

	RED.nodes.registerType("rainbird-server", RemoteServerNode);
};

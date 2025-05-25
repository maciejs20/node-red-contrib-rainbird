
module.exports = function (RED) {
	function RainbirdNode(config) {
		RED.nodes.createNode(this, config);
		this.log("[rainbird.js]: Starting rainbird LNK2 node. Config: "+JSON.stringify(config));
		this.server = RED.nodes.getNode(config.server);

		if (this.server) {
			this.rainIp = this.server.rainIp;
			this.rainKey = this.server.rainKey;
			this.lnk2 = this.server.lnk2;
			this.log("Server configuration loaded successfully.");
		} else {
			this.error("No config node available.");
			return;
		}

		var node = this;

		node.on("input", function (msg) {
		
            if (!msg.device) {
                node.error("No msg.device provided");
                return;
            }

            if (!msg.command) {
                node.error("[No msg.command provided");
                return;
            }

			node.send(msg);
		});
	}
	RED.nodes.registerType("rainbird", RainbirdNode);
};

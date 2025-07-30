const sipCommands = require("./rainbird-sip-commands");

module.exports = function (RED) {
    function RainbirdSupportedCommandsNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.log("Starting Rainbird LNK2 rainbird-supported-commands node.");

        this.server = RED.nodes.getNode(config.server);
        if (!this.server || !this.server.rainIp || !this.server.rainKey) {
            node.error("Missing or invalid server configuration.");
            node.status({ fill: "red", shape: "ring", text: "Invalid configuration" });
            return;
        }

        const rainbird = this.server.getInstance();

        node.on("input", async (msg) => {
            let statusTimer = null;
            let currentCommand = null;

            const updateStatus = () => {
                if (currentCommand !== null) {
                    node.status({ fill: "yellow", shape: "dot", text: `Checking 0x${currentCommand.toString(16).toUpperCase().padStart(2, "0")}...` });
                }
            };

            node.status({ fill: "yellow", shape: "dot", text: "Starting check..." });
            statusTimer = setInterval(updateStatus, 2000);

            try {
                const knownCommands = sipCommands.ControllerCommands;
                const supported = [];
                const notSupported = [];

                for (let command = 0; command <= 0xFF; command++) {
                    currentCommand = command;
                    let supportedCmd = false;

                    try {
                        supportedCmd = await rainbird.checkCommandSupport(command);
                    } catch (err) {
                        node.warn(`Error checking command 0x${command.toString(16).padStart(2, "0")}: ${err.message}`);
                    }

                    const known = Object.keys(knownCommands).find(
                        (k) => parseInt(knownCommands[k].command, 16) === command
                    );

                    if (supportedCmd) {
                        supported.push({
                            commandHex: "0x" + command.toString(16).toUpperCase().padStart(2, "0"),
                            name: known || "Unknown"
                        });
                    } else if (known) {
                        notSupported.push({
                            commandHex: "0x" + command.toString(16).toUpperCase().padStart(2, "0"),
                            name: known
                        });
                    }
                }

                msg.payload = { supported, "not-supported": notSupported };
                node.send(msg);

                node.status({ fill: "green", shape: "dot", text: "Done" });
                setTimeout(() => node.status({}), 5000);
            } catch (err) {
                node.error(`Error checking supported commands: ${err.message}`, msg);
                node.status({ fill: "red", shape: "ring", text: err.message });
            } finally {
                clearInterval(statusTimer);
                currentCommand = null;
            }
        });
    }

    RED.nodes.registerType("rainbird-supported-commands", RainbirdSupportedCommandsNode);
};

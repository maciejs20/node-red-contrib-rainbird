module.exports = function (RED) {
    function cleanType(obj) {
        if (obj && typeof obj === "object" && "_type" in obj) {
            delete obj._type;
        }
        return obj;
    }

    function RainbirdNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;

        node.log("Starting Rainbird LNK2 rainbird-state node.");

        this.server = RED.nodes.getNode(config.server);
        if (!this.server || !this.server.rainIp || !this.server.rainKey) {
            node.error("Missing or invalid server configuration.");
            node.status({ fill: "red", shape: "ring", text: "Invalid configuration" });
            return;
        }

        const rainbird = this.server.getInstance();

        // === Main Logic ===
        node.on("input", async (msg) => {
            node.status({ fill: "yellow", shape: "dot", text: "Querying..." });

            try {
                // --- Check support for CombinedControllerStateRequest (0x4C) ---
                const supportsCombinedState = await rainbird.checkCommandSupport(0x4C);
                if (!supportsCombinedState) {
                    node.log("Controller does NOT support CombinedControllerStateRequest (0x4C)");
                }

                // --- Always get irrigation state ---
                const irrigationState = cleanType(await rainbird.getIrrigationState());

                // --- If supported, get combined state ---
                let combinedState = {};
                if (supportsCombinedState) {
                    combinedState = cleanType(await rainbird.getCombinedControllerState());
                }

                const result = {
                    irrigationState: irrigationState,
                    activeStation: combinedState.activeStation || null,
                    remainingRuntime: combinedState.remainingRuntime || null,
                    irrigationActive: combinedState.irrigationState || null,
                    rainSensor: combinedState.sensorState || null
                };

                msg.payload = cleanType(result);
                node.send(msg);

                node.status({ fill: "green", shape: "dot", text: "OK" });
                setTimeout(() => node.status({}), 5000);
            } catch (err) {
                node.error(`LNK2 Rainbird call error: ${err.message}`, msg);
                node.status({ fill: "red", shape: "ring", text: err.message });
            }
        });
    }

    RED.nodes.registerType("rainbird-state", RainbirdNode);
};

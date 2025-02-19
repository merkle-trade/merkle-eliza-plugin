import type { Plugin } from "@elizaos/core";
import openOrder from "./actions/openOrder";
import fullyClosePosition from "./actions/fullyClosePosition";
import getOrder from "./actions/getOrder";
import getPosition from "./actions/getPosition";
import getBalance from "./actions/getBalance";
import getPrice from "./actions/getPrice";

const merklePlugin: Plugin = {
	name: "merkle",
	description: "Merkle Plugin for Eliza",
	actions: [openOrder, fullyClosePosition, getOrder, getPosition, getBalance, getPrice],
	evaluators: [],
  services: [],
	providers: [],
};

export * from "./service";
export * from "./utils";
export { merklePlugin };
export default merklePlugin;

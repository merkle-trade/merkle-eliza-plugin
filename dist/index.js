// src/actions/openOrder.ts
import { elizaLogger as elizaLogger2, generateObjectDeprecated } from "@elizaos/core";
import {
  ModelClass
} from "@elizaos/core";
import { composeContext } from "@elizaos/core";

// src/types.ts
import { z } from "zod";
var OpenOrderSchema = z.object({
  coinSymbol: z.string().toUpperCase(),
  pay: z.number(),
  leverage: z.number(),
  type: z.enum(["MARKET", "LIMIT"]),
  side: z.enum(["LONG", "SHORT"]),
  limitOrderPrice: z.number().optional().nullable()
});
var FullyClosePositionSchema = z.object({
  coinSymbol: z.string().toUpperCase(),
  side: z.enum(["LONG", "SHORT"])
});
var GetPriceSchema = z.object({
  coinSymbol: z.string().toUpperCase()
});

// src/service.ts
import { Aptos } from "@aptos-labs/ts-sdk";
import { elizaLogger } from "@elizaos/core";
import {
  MerkleClient,
  AptosHelpers,
  calcEntryByPaySize,
  fromNumber,
  Decimals,
  raise
} from "@merkletrade/ts-sdk";
import NodeCache from "node-cache";
var MerkleService = class {
  constructor(config, account) {
    this.cacheKey = "merkle/provider";
    this.client = new MerkleClient(config);
    this.aptosHelper = new AptosHelpers(config);
    this.cache = new NodeCache({ stdTTL: 300 });
    this.account = account;
    this.summary = config.summary;
    this.aptos = new Aptos(config.aptosConfig);
  }
  /**
   * Trading operations
   */
  /**
   * Place a market order
   * @param pair string
   * @param pay number
   * @param leverage number
   * @param isLong boolean
   * @returns Transaction
   */
  async placeMarketOrder({
    pair,
    pay,
    leverage,
    isLong
  }) {
    const pairInfo = await this.client.getPairInfo({ pairId: pair });
    const pairState = await this.client.getPairState({ pairId: pair });
    const payWithDecimals = fromNumber(pay, Decimals.COLLATERAL);
    const { collateral, size } = calcEntryByPaySize(
      payWithDecimals,
      leverage,
      isLong,
      pairInfo,
      pairState
    );
    const payload = this.client.payloads.placeMarketOrder({
      pair: pairInfo.pairType,
      userAddress: this.getAccountAddress(),
      sizeDelta: size,
      collateralDelta: collateral,
      isLong,
      isIncrease: true
    });
    return await sendTransaction(this.aptos, this.account, payload);
  }
  /**
   * Place a limit order
   * @param pair string
   * @param pay number
   * @param leverage number
   * @param isLong boolean
   * @param limitOrderPrice number
   * @returns Transaction
   */
  async placeLimitOrder({
    pair,
    pay,
    leverage,
    isLong,
    limitOrderPrice
  }) {
    const pairInfo = await this.client.getPairInfo({ pairId: pair });
    const pairState = await this.client.getPairState({ pairId: pair });
    const payWithDecimals = fromNumber(pay, Decimals.COLLATERAL);
    const { collateral, size } = calcEntryByPaySize(
      payWithDecimals,
      leverage,
      isLong,
      pairInfo,
      pairState
    );
    const payload = this.client.payloads.placeLimitOrder({
      pair: pairInfo.pairType,
      userAddress: this.getAccountAddress(),
      sizeDelta: size,
      collateralDelta: collateral,
      price: fromNumber(limitOrderPrice, Decimals.PRICE),
      isLong,
      isIncrease: true
    });
    return await sendTransaction(this.aptos, this.account, payload);
  }
  /**
   * Close all positions
   * @returns Transaction[]
   */
  async closeAllPositions() {
    const positions = await this.getPositions();
    const txs = [];
    for (const position of positions) {
      const tx = await this.closePosition(position);
      txs.push(tx);
    }
    return txs;
  }
  /**
   * Close a position
   * @param position Position
   * @returns Transaction
   */
  async closePosition(position) {
    try {
      const payload = this.client.payloads.placeMarketOrder({
        pair: position.pairType,
        userAddress: this.getAccountAddress(),
        sizeDelta: position.size,
        collateralDelta: position.collateral,
        isLong: position.isLong,
        isIncrease: false
      });
      const tx = await sendTransaction(this.aptos, this.account, payload);
      return tx;
    } catch (error) {
      throw this.handleError(error, "closePosition");
    }
  }
  /**
   * Account-related operations
   */
  getAccount() {
    return this.account;
  }
  /**
   * Get account address
   * @returns Hex
   */
  getAccountAddress() {
    return this.account.accountAddress.toStringLong();
  }
  /**
   * Get positions of the account
   * @returns Position[]
   */
  async getPositions() {
    const address = this.getAccountAddress();
    try {
      return await this.client.getPositions({ address });
    } catch (error) {
      throw this.handleError(error, `getPositions: ${address}`);
    }
  }
  /**
   * Get orders of the account
   * @returns Order[]
   */
  async getOrders() {
    const address = this.getAccountAddress();
    try {
      return await this.client.getOrders({ address });
    } catch (error) {
      throw this.handleError(error, `getOrders: ${address}`);
    }
  }
  /**
   * Get balance of the account
   * @returns AccountBalance
   */
  async getBalance() {
    try {
      const usdcBalance = await this.aptosHelper.getUsdcBalance(this.account);
      return { usdc: usdcBalance };
    } catch (error) {
      throw this.handleError(error, "getBalance");
    }
  }
  /**
   * Market-related operations
   */
  async getLatestPrice(pair) {
    let session;
    try {
      const pairInfo = this.getPair(pair);
      session = await this.client.connectWsApi();
      await session.connect();
      const priceFeed = session.subscribePriceFeed(pairInfo.id);
      const price = await withTimeout(firstAsync(priceFeed), 5e3);
      return price;
    } catch (error) {
      throw this.handleError(error, "getLatestPrice");
    } finally {
      session?.disconnect();
    }
  }
  /**
   * Get summary of the account
   * @returns SummaryResponse
   */
  async getSummary() {
    try {
      const cachedSummary = this.cache.get(`${this.cacheKey}/summary`);
      if (cachedSummary) {
        return cachedSummary;
      }
      const summary = await this.client.getSummary();
      this.cache.set(`${this.cacheKey}/summary`, summary);
      return summary;
    } catch (error) {
      throw this.handleError(error, "getSummary");
    }
  }
  getPair(rawPair) {
    return this.summary.pairs.find((pair) => pair.id.toUpperCase().includes(rawPair.toUpperCase())) ?? raise("Pair not found");
  }
  handleError(error, context) {
    elizaLogger.error("Unexpected error: ", { context, error });
    throw error;
  }
};

// src/utils.ts
import { Account, Ed25519PrivateKey, PrivateKey, PrivateKeyVariants } from "@aptos-labs/ts-sdk";
import { MerkleClientConfig } from "@merkletrade/ts-sdk";
var checkEnv = (runtime) => {
  return !!(runtime.getSetting("MERKLE_TRADE_APTOS_PRIVATE_KEY") && runtime.getSetting("MERKLE_TRADE_NETWORK"));
};
var newMerkleService = async (runtime) => {
  const network = runtime.getSetting("MERKLE_TRADE_NETWORK");
  const config = network === "mainnet" ? await MerkleClientConfig.mainnet() : await MerkleClientConfig.testnet();
  const privateKey = runtime.getSetting("MERKLE_TRADE_APTOS_PRIVATE_KEY");
  const merkleAccount = Account.fromPrivateKey({
    privateKey: new Ed25519PrivateKey(
      PrivateKey.formatPrivateKey(privateKey, PrivateKeyVariants.Ed25519)
    )
  });
  const merkleService = new MerkleService(config, merkleAccount);
  return merkleService;
};
var firstAsync = async (iterable) => {
  for await (const value of iterable) {
    return value;
  }
  throw new Error("Failed to get value from async iterable");
};
var withTimeout = (promise, ms) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${ms}ms exceeded`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
};
var sendTransaction = async (aptos, account, payload) => {
  const transaction = await aptos.transaction.build.simple({
    sender: account.accountAddress,
    data: payload
  });
  const { hash } = await aptos.signAndSubmitTransaction({
    signer: account,
    transaction
  });
  return await aptos.waitForTransaction({ transactionHash: hash });
};

// src/actions/openOrder.ts
var openOrderTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "coinSymbol": "BTC",
    "pay": 1000,
    "leverage": 10,
    "side": "LONG",
    "type": "MARKET"
}
\`\`\`

\`\`\`json
{
    "coinSymbol": "BTC",
    "pay": 1000,
    "leverage": 10,
    "side": "SHORT",
    "type": "LIMIT",
    "limitOrderPrice": 98000
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested futures position order:
- coinSymbol : Coin symbol (Must be a valid coin symbol, Must be provided by the user)
- pay : Pay amount (Must be a number, Must be provided by the user)
- leverage : Leverage (Must be 3 to 1000, Must be provided by the user)
- type : Type of order (Must be "MARKET" or "LIMIT")
- side : Side of the position (Must be "LONG" or "SHORT", Must be provided by the user)
- limitOrderPrice : Limit order price (Must be a number, optional)

Respond with a JSON markdown block containing only the extracted values.`;
var openOrder_default = {
  name: "OPEN_ORDER",
  similes: [
    "FUTURES_TRADE",
    "OPEN_MARKET_ORDER",
    "OPEN_LIMIT_ORDER",
    "BUY_LONG",
    "BUY_SHORT",
    "OPEN_POSITION",
    "PLACE_ORDER"
  ],
  description: "Open a futures position on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "Open a BTC Long position on the Merkle Trade platform with 1000 pay and 10 leverage"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Successfully market order BTC with 1000 pay and 10 leverage, Transaction: 0x104af5d1a786a2e1a4721a721b2cfccc7e15fa41eec15a489ba1768790adb523",
          action: "OPEN_ORDER"
        }
      }
    ],
    [
      {
        user: "{{user}}",
        content: {
          text: "Buy a BTC on the Merkle Trade platform with 100 pay and 100 leverage"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Is it a long position or a short position?"
        }
      },
      {
        user: "{{user}}",
        content: {
          text: "Short Position"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Successfully open short position BTC with 1000 pay and 10 leverage, Transaction: 0x104af5d1a786a2e1a4721a721b2cfccc7e15fa41eec15a489ba1768790adb523",
          action: "OPEN_ORDER"
        }
      }
    ],
    [
      {
        user: "{{user}}",
        content: {
          text: "Open a BTC Long position on the Merkle Trade platform with 1000 pay and 10 leverage at 98000"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Successfully limit order BTC at 98000 with 1000 pay and 10 leverage, Transaction: 0x104af5d1a786a2e1a4721a721b2cfccc7e15fa41eec15a489ba1768790adb523",
          action: "OPEN_ORDER"
        }
      }
    ],
    [
      {
        user: "{{user}}",
        content: {
          text: "Execute a ETH limit order on the Merkle Trade platform with 1000 pay and 10 leverage at 98000"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Is it a long position or a short position?"
        }
      },
      {
        user: "{{user}}",
        content: {
          text: "Long Position"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Successfully limit long order ETH at 98000 with 1000 pay, 10 leverage, Transaction: 0x104af5d1a786a2e1a4721a721b2cfccc7e15fa41eec15a489ba1768790adb523",
          action: "OPEN_ORDER"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    let content;
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const context = composeContext({
        state: currentState,
        template: openOrderTemplate
      });
      content = await generateObjectDeprecated({
        runtime,
        context,
        modelClass: ModelClass.LARGE
      });
      if (content && typeof content.pay === "string") {
        content.pay = Number.parseFloat(content.pay);
      }
      if (content && typeof content.leverage === "string") {
        content.leverage = Number.parseFloat(content.leverage);
      }
      if (content && typeof content.side === "string") {
        switch (content.side.toUpperCase()) {
          case "LONG":
            content.side = "LONG";
            break;
          case "SHORT":
            content.side = "SHORT";
            break;
          default:
            throw new Error("Must be provide a valid side. Long or Short");
        }
      }
      if (content && typeof content.type === "string") {
        switch (content.type.toUpperCase()) {
          case "MARKET":
            content.type = "MARKET";
            break;
          case "LIMIT":
            content.type = "LIMIT";
            break;
          default:
            throw new Error("Invalid type");
        }
      }
      if (content && typeof content.limitOrderPrice === "string") {
        content.limitOrderPrice = content.limitOrderPrice === "null" ? null : Number.parseFloat(content.limitOrderPrice);
      }
      const parseResult = OpenOrderSchema.safeParse(content);
      if (!parseResult.success) {
        throw new Error(
          `Invalid open order content:
${JSON.stringify(content, null, 2)}
${JSON.stringify(parseResult.error.errors, null, 2)}`
        );
      }
      const merkleService = await newMerkleService(runtime);
      let tx;
      if (content && typeof content.type === "string" && content.type === "LIMIT") {
        tx = await merkleService.placeLimitOrder({
          pair: content.coinSymbol,
          pay: content.pay,
          leverage: content.leverage,
          isLong: content.side === "LONG",
          limitOrderPrice: content.limitOrderPrice
        });
        if (callback) {
          callback({
            text: `Successfully limit order ${content.coinSymbol} at ${content.limitOrderPrice} with ${content.pay} pay, ${content.leverage} leverage, and ${content.side} position, Transaction: ${tx.hash}`,
            content: tx
          });
        }
      } else {
        tx = await merkleService.placeMarketOrder({
          pair: content.coinSymbol,
          pay: content.pay,
          leverage: content.leverage,
          isLong: content.side === "LONG"
        });
        if (callback) {
          callback({
            text: `Successfully market order ${content.coinSymbol} with ${content.pay} pay, ${content.leverage} leverage, and ${content.side} position, Transaction: ${tx.hash}`,
            content: tx
          });
        }
      }
      elizaLogger2.log("Open order successful:", tx.hash);
      return true;
    } catch (error) {
      elizaLogger2.error("Error during open order:", {
        content,
        message: error.message
      });
      if (callback) {
        callback({
          text: `Error during open order: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  }
};

// src/actions/fullyClosePosition.ts
import { elizaLogger as elizaLogger3, generateObjectDeprecated as generateObjectDeprecated2 } from "@elizaos/core";
import {
  ModelClass as ModelClass2
} from "@elizaos/core";
import { composeContext as composeContext2 } from "@elizaos/core";
var fullyCloseOrderTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "coinSymbol": "BTC",
    "side": "LONG",
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested futures position order:
- coinSymbol : Coin symbol (Must be a valid coin symbol, Must be provided by the user)
- side : Side of the position (Must be "LONG" or "SHORT", Must be provided by the user)

Respond with a JSON markdown block containing only the extracted values.`;
var fullyClosePosition_default = {
  name: "FULLY_CLOSE_POSITION",
  similes: ["CLOSE_POSITION"],
  description: "Fully close all positions on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "Close BTC Long position on the Merkle Trade platform"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Successfully close position BTC with LONG position, Transaction: 0x104af5d1a786a2e1a4721a721b2cfccc7e15fa41eec15a489ba1768790adb523",
          action: "FULLY_CLOSE_POSITION"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    let content;
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const context = composeContext2({
        state: currentState,
        template: fullyCloseOrderTemplate
      });
      content = await generateObjectDeprecated2({
        runtime,
        context,
        modelClass: ModelClass2.LARGE
      });
      if (content && typeof content.side === "string") {
        switch (content.side.toUpperCase()) {
          case "LONG":
            content.side = "LONG";
            break;
          case "SHORT":
            content.side = "SHORT";
            break;
          default:
            throw new Error("Invalid side");
        }
      }
      const parseResult = FullyClosePositionSchema.safeParse(content);
      if (!parseResult.success) {
        throw new Error(
          `Invalid open order content: ${JSON.stringify(parseResult.error.errors, null, 2)}`
        );
      }
      const { coinSymbol, side } = parseResult.data;
      const merkleService = await newMerkleService(runtime);
      const positions = await merkleService.getPositions();
      const position = positions.find((p) => p.pairType.split("::")[2].includes(coinSymbol.toUpperCase()) && p.isLong === (side === "LONG"));
      if (!position) {
        throw new Error(`Position not found for ${coinSymbol} with ${side} position`);
      }
      const tx = await merkleService.closePosition(position);
      if (callback) {
        callback({
          text: `Successfully close position ${coinSymbol} with ${side} position, Transaction: ${tx.hash}`,
          content: tx
        });
      }
      elizaLogger3.info("Successfully close position", tx.hash);
      return true;
    } catch (error) {
      elizaLogger3.error("Error during fully close position:", {
        content,
        message: error.message
      });
      if (callback) {
        callback({
          text: `Error during fully close position: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  }
};

// src/actions/getOrder.ts
import { elizaLogger as elizaLogger4 } from "@elizaos/core";
import { toNumber } from "@merkletrade/ts-sdk";
var getOrder_default = {
  name: "GET_ORDER",
  similes: ["ORDER"],
  description: "Get the order of the user on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "Get the order of the user on the Merkle Trade platform"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Orders\n----------------------------\nETH (Long, increase) order: 9940.36$ at 2600$\nBTC (Long, increase) order: 970.87$ at 80000$",
          action: "GET_ORDER"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const merkleService = await newMerkleService(runtime);
      const orders = await merkleService.getOrders();
      if (!orders) {
        throw new Error("Orders not found");
      }
      const tableData = orders.map((order) => [
        order.pairType.split("::")[2].split("_")[0],
        order.isLong ? "Long" : "Short",
        order.isIncrease ? "Increase" : "Decrease",
        toNumber(order.sizeDelta, 6).toFixed(2),
        toNumber(order.price, 10)
      ]);
      const logs = tableData.map((row) => {
        const [pair, side, type, size, price] = row;
        return `${pair} (${side}, ${String(type).toLowerCase()}) order: ${size}$ at ${price}$`;
      });
      if (callback) {
        callback({ text: `Orders
----------------------------
${logs.join("\n")}` });
      }
      elizaLogger4.info("Successfully get orders");
      return true;
    } catch (error) {
      elizaLogger4.error("Error during get orders:", { message: error.message });
      if (callback) {
        callback({ text: `Error during get orders: ${error.message}` });
      }
      return false;
    }
  }
};

// src/actions/getPosition.ts
import { elizaLogger as elizaLogger5 } from "@elizaos/core";
import { calcPnlWithoutFee, fromNumber as fromNumber2, toNumber as toNumber2 } from "@merkletrade/ts-sdk";
var getPosition_default = {
  name: "GET_POSITION",
  similes: ["POSITION"],
  description: "Get the position of the user on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "Get the position of the user on the Merkle Trade platform"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Positions\n----------------------------\nETH (50x Long)\nAvg Price: 2783.714542352$\nCollateral: 19.417476$\nPnL: -37.36% (-7.26$)",
          action: "GET_POSITION"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const merkleService = await newMerkleService(runtime);
      const positions = await merkleService.getPositions();
      if (!positions) {
        throw new Error("Positions not found");
      }
      const summary = await merkleService.getSummary();
      if (!summary) {
        throw new Error("Summary not found");
      }
      const logs = [
        "Positions",
        ...positions.map((position) => {
          const pair = position.pairType.split("::")[2].split("_")[0];
          const side = position.isLong ? "Long" : "Short";
          const collateral = toNumber2(position.collateral, 6);
          const leverage = Math.round(toNumber2(position.size, 6) / collateral);
          const currentPrice = fromNumber2(summary.prices.find((price) => price.id.includes(pair))?.price, 10);
          const avgPrice = toNumber2(position.avgPrice, 10).toFixed(2);
          const pnl = toNumber2(calcPnlWithoutFee({
            position,
            executePrice: currentPrice,
            decreaseOrder: { sizeDelta: position.size }
          }), 6);
          const pnlRate = (pnl / collateral * 100).toFixed(2);
          return `${pair} (${leverage}x ${side})
Avg Price: ${avgPrice}$
Collateral: ${collateral.toFixed(2)}$
PnL: ${pnlRate}% (${pnl.toFixed(2)}$)`;
        })
      ].join("\n----------------------------\n");
      if (callback) {
        callback({ text: logs });
      }
      elizaLogger5.info("Successfully get orders");
      return true;
    } catch (error) {
      elizaLogger5.error("Error during get orders:", { message: error.message });
      if (callback) {
        callback({ text: `Error during get orders: ${error.message}` });
      }
      return false;
    }
  }
};

// src/actions/getBalance.ts
import { elizaLogger as elizaLogger6 } from "@elizaos/core";
import { toNumber as toNumber3 } from "@merkletrade/ts-sdk";
var getBalance_default = {
  name: "GET_BALANCE",
  similes: ["BALANCE"],
  description: "Get the balance of the user on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "What is my balance?"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "Balance:\nUSDC	|	1000000",
          action: "GET_BALANCE"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const merkleService = await newMerkleService(runtime);
      const balance = await merkleService.getBalance();
      if (!balance) {
        throw new Error("Balance not found");
      }
      const usdc = toNumber3(balance.usdc, 6);
      if (callback) {
        callback({ text: `Balance:
USDC	|	${usdc}` });
      }
      elizaLogger6.info("Successfully get balance");
      return true;
    } catch (error) {
      elizaLogger6.error("Error during get balance:", {
        message: error.message
      });
      if (callback) {
        callback({
          text: `Error during get balance: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  }
};

// src/actions/getPrice.ts
import { elizaLogger as elizaLogger7, generateObjectDeprecated as generateObjectDeprecated3 } from "@elizaos/core";
import {
  ModelClass as ModelClass3
} from "@elizaos/core";
import { composeContext as composeContext3 } from "@elizaos/core";
var getPriceTemplate = `Respond with a JSON markdown block containing only the extracted values. Use null for any values that cannot be determined.

Example response:
\`\`\`json
{
    "coinSymbol": "BTC"
}
\`\`\`

{{recentMessages}}

Given the recent messages, extract the following information about the requested futures position order:
- coinSymbol : Coin symbol (Must be a valid coin symbol, Must be provided by the user)

Respond with a JSON markdown block containing only the extracted values.`;
var getPrice_default = {
  name: "GET_PRICE",
  similes: ["PRICE"],
  description: "Get the price of the coin on the Merkle Trade platform",
  examples: [
    [
      {
        user: "{{user}}",
        content: {
          text: "What is the price of BTC?"
        }
      },
      {
        user: "{{agent}}",
        content: {
          text: "The price of BTC is 98000",
          action: "GET_PRICE"
        }
      }
    ]
  ],
  validate: async (runtime) => {
    return checkEnv(runtime);
  },
  handler: async (runtime, message, state, _options, callback) => {
    let content;
    try {
      let currentState = state;
      if (!currentState) {
        currentState = await runtime.composeState(message);
      } else {
        currentState = await runtime.updateRecentMessageState(currentState);
      }
      const context = composeContext3({
        state: currentState,
        template: getPriceTemplate
      });
      content = await generateObjectDeprecated3({
        runtime,
        context,
        modelClass: ModelClass3.SMALL
      });
      const parseResult = GetPriceSchema.safeParse(content);
      if (!parseResult.success) {
        throw new Error(
          `Invalid get price content:
${JSON.stringify(content, null, 2)}
${JSON.stringify(parseResult.error.errors, null, 2)}`
        );
      }
      const merkleService = await newMerkleService(runtime);
      const summary = await merkleService.getSummary();
      if (!summary) {
        throw new Error("Summary not found");
      }
      const price = summary.prices.find((price2) => price2.id.includes(content.coinSymbol));
      if (!price) {
        throw new Error("Price not found");
      }
      if (callback) {
        callback({
          text: `The price of ${content.coinSymbol} is ${price.price}`,
          content: price
        });
      }
      elizaLogger7.info("Successfully get price");
      return true;
    } catch (error) {
      elizaLogger7.error("Error during get price:", {
        message: error.message
      });
      if (callback) {
        callback({
          text: `Error during get price: ${error.message}`,
          content: { error: error.message }
        });
      }
      return false;
    }
  }
};

// src/index.ts
var merklePlugin = {
  name: "merkle",
  description: "Merkle Plugin for Eliza",
  actions: [openOrder_default, fullyClosePosition_default, getOrder_default, getPosition_default, getBalance_default, getPrice_default],
  evaluators: [],
  services: [],
  providers: []
};
var index_default = merklePlugin;
export {
  MerkleService,
  checkEnv,
  index_default as default,
  firstAsync,
  merklePlugin,
  newMerkleService,
  sendTransaction,
  withTimeout
};
//# sourceMappingURL=index.js.map
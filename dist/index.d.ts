import { IAgentRuntime, Plugin } from '@elizaos/core';
import * as _merkletrade_ts_sdk from '@merkletrade/ts-sdk';
import { MerkleClientConfig, Position, Hex, Order, Decimals, Summary } from '@merkletrade/ts-sdk';
import * as _aptos_labs_ts_sdk from '@aptos-labs/ts-sdk';
import { Account, CommittedTransactionResponse, Aptos, InputEntryFunctionData } from '@aptos-labs/ts-sdk';

declare class MerkleService {
    private client;
    private aptos;
    private aptosHelper;
    private cache;
    private cacheKey;
    private account;
    private summary;
    constructor(config: MerkleClientConfig, account: Account);
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
    placeMarketOrder({ pair, pay, leverage, isLong, }: {
        pair: string;
        pay: number;
        leverage: number;
        isLong: boolean;
    }): Promise<CommittedTransactionResponse>;
    /**
     * Place a limit order
     * @param pair string
     * @param pay number
     * @param leverage number
     * @param isLong boolean
     * @param limitOrderPrice number
     * @returns Transaction
     */
    placeLimitOrder({ pair, pay, leverage, isLong, limitOrderPrice, }: {
        pair: string;
        pay: number;
        leverage: number;
        isLong: boolean;
        limitOrderPrice: number;
    }): Promise<CommittedTransactionResponse>;
    /**
     * Close all positions
     * @returns Transaction[]
     */
    closeAllPositions(): Promise<CommittedTransactionResponse[]>;
    /**
     * Close a position
     * @param position Position
     * @returns Transaction
     */
    closePosition(position: Position): Promise<CommittedTransactionResponse>;
    /**
     * Account-related operations
     */
    getAccount(): Account;
    /**
     * Get account address
     * @returns Hex
     */
    getAccountAddress(): Hex;
    /**
     * Get positions of the account
     * @returns Position[]
     */
    getPositions(): Promise<Position[]>;
    /**
     * Get orders of the account
     * @returns Order[]
     */
    getOrders(): Promise<Order[]>;
    /**
     * Get balance of the account
     * @returns AccountBalance
     */
    getBalance(): Promise<AccountBalance>;
    /**
     * Market-related operations
     */
    getLatestPrice(pair: string): Promise<_merkletrade_ts_sdk.PriceFeed>;
    /**
     * Get summary of the account
     * @returns SummaryResponse
     */
    getSummary(): Promise<Summary>;
    private getPair;
    private handleError;
}
type AccountBalance = {
    usdc: Decimals.Collateral;
};

declare const checkEnv: (runtime: IAgentRuntime) => boolean;
declare const newMerkleService: (runtime: IAgentRuntime) => Promise<MerkleService>;
declare const firstAsync: <T>(iterable: AsyncIterable<T>) => Promise<T>;
declare const withTimeout: <T>(promise: Promise<T>, ms: number) => Promise<T>;
declare const sendTransaction: (aptos: Aptos, account: Account, payload: InputEntryFunctionData) => Promise<_aptos_labs_ts_sdk.CommittedTransactionResponse>;

declare const merklePlugin: Plugin;

export { type AccountBalance, MerkleService, checkEnv, merklePlugin as default, firstAsync, merklePlugin, newMerkleService, sendTransaction, withTimeout };

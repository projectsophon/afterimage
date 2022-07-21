import {
  CONTRACT_ADDRESS
} from '@zkgame/contracts';
import {
  Transaction,
  TxIntent,
} from "@darkforest_eth/types";
import {
  address,
} from '../utils';
import type { ZKGame } from '@zkgame/typechain';
import {
  ContractCaller,
  EthConnection,
  ethToWei,
  // QueuedTransaction,
  TxExecutor,
} from '@darkforest_eth/network';
import { EventEmitter } from 'events';
import {
  BigNumber as EthersBN,
  Contract,
  ContractFunction /*, ethers, Event, providers*/,
  providers,
} from 'ethers';
import {
  ContractEvent,
  ContractMethodName,
  ContractsAPIEvent,
  SubmittedInitPlayer,
  SubmittedMovePlayer,
  SubmittedTx,
  UnconfirmedInitPlayer,
  UnconfirmedMovePlayer,
} from '../_types/ContractAPITypes';
import {
  loadCoreContract,
} from './Blockchain';

/**
 * Roughly contains methods that map 1:1 with functions that live in the contract. Responsible for
 * reading and writing to and from the blockchain.
 *
 * @todo don't inherit from {@link EventEmitter}. instead use {@link Monomitter}
 */
export class ContractsAPI extends EventEmitter {
  /**
   * Don't allow users to submit txs if balance falls below this amount/
   */
  private static readonly MIN_BALANCE = ethToWei(0.002);

  /**
   * Instrumented {@link ThrottledConcurrentQueue} for blockchain reads.
   */
  private readonly contractCaller: ContractCaller;

  /**
   * Instrumented {@link ThrottledConcurrentQueue} for blockchain writes.
   */
  private readonly txExecutor: TxExecutor | undefined;

  /**
   * Our connection to the blockchain. In charge of low level networking, and also of the burner
   * wallet.
   */
  private ethConnection: EthConnection;

  private abiCache: Map<string, any[]>;

  get coreContract() {
    return this.ethConnection.getContract<ZKGame>(CONTRACT_ADDRESS);
  }

  public constructor(ethConnection: EthConnection) {
    super();
    this.contractCaller = new ContractCaller();
    this.ethConnection = ethConnection;
    this.txExecutor = new TxExecutor(
      ethConnection,
      this.getGasFeeForTransaction.bind(this),
      this.beforeQueued.bind(this),
      this.beforeTransaction.bind(this),
      this.afterTransaction.bind(this)
    );
    this.abiCache = new Map();

    this.setupEventListeners();
  }

    /**
   * We pass this function into {@link TxExecutor} to calculate what gas fee we should use for the
   * given transaction. The result is either a number, measured in gwei, represented as a string, or
   * a string representing that we want to use an auto gas setting.
   */
  private getGasFeeForTransaction(tx: Transaction): string {
    return '50';
  }

  /**
   * This function is called by {@link TxExecutor} before a transaction is queued.
   * It gives the client an opportunity to prevent a transaction from being queued based
   * on business logic or user interaction.
   *
   * Reject the promise to prevent the queued transaction from being queued.
   */
  private async beforeQueued(
    id: number,
    intent: TxIntent,
    overrides?: providers.TransactionRequest
  ): Promise<void> {
    const address = this.ethConnection.getAddress();
    if (!address) throw new Error("can't send a transaction, no signer");

    const balance = await this.ethConnection.loadBalance(address);

    if (balance.lt(ContractsAPI.MIN_BALANCE)) {
      throw new Error('xDAI balance too low!');
    }
  }

  /**
   * This function is called by {@link TxExecutor} before each transaction. It gives the client an
   * opportunity to prevent a transaction from going through based on business logic or user
   * interaction. To prevent the queued transaction from being submitted, throw an Error.
   */
  private async beforeTransaction(tx: Transaction): Promise<void> {
    console.log('Processing', tx);
  }

  private async afterTransaction(_txRequest: Transaction, txDiagnosticInfo: unknown) {
    this.emit(ContractsAPIEvent.TxSubmitted, txDiagnosticInfo);
  }


  public destroy(): void {
    this.removeEventListeners();
  }

  private makeCall<T>(contractViewFunction: ContractFunction<T>, args: unknown[] = []): Promise<T> {
    return this.contractCaller.makeCall(contractViewFunction, args);
  }

  public async setupEventListeners(): Promise<void> {
    const { coreContract } = this;

    const filter = {
      address: coreContract.address,
      topics: [
        [
          coreContract.filters.PlayerUpdated(null, null).topics,
        ].map((topicsOrUndefined) => (topicsOrUndefined || [])[0]),
      ] as Array<string | Array<string>>,
    };

    const eventHandlers = {
      [ContractEvent.PlayerUpdated]: (rawAddress: string, commitment: number) => {
        this.emit(ContractsAPIEvent.PlayerUpdated, address(rawAddress), commitment);
      },
    };

    this.ethConnection.subscribeToContractEvents(coreContract, eventHandlers, filter);
  }

  public removeEventListeners(): void {
    const { coreContract } = this;

    coreContract.removeAllListeners(ContractEvent.PlayerUpdated);
    coreContract.removeAllListeners(ContractEvent.TileUpdated);
  }

  public async getGridUpperBound(): Promise<number> {
    return (await this.makeCall<EthersBN>(this.coreContract.GRID_UPPER_BOUND)).toNumber();
  }

  /**
   * Given an unconfirmed (but submitted) transaction, emits the appropriate
   * [[ContractsAPIEvent]].
   */
  public waitFor(submitted: SubmittedTx, receiptPromise: Promise<providers.TransactionReceipt>) {
    this.emit(ContractsAPIEvent.TxSubmitted, submitted);

    return receiptPromise
      .then((receipt) => {
        this.emit(ContractsAPIEvent.TxConfirmed, submitted);
        return receipt;
      })
      .catch((e) => {
        this.emit(ContractsAPIEvent.TxReverted, submitted, e);
        throw e;
      });
  }
}

export async function makeContractsAPI(ethConnection: EthConnection): Promise<ContractsAPI> {
  // Could turn this into an array and iterate, but I like the explicitness
  await ethConnection.loadContract(CONTRACT_ADDRESS, loadCoreContract);
  return new ContractsAPI(ethConnection);
}
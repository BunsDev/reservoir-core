import { BigNumberish } from "@ethersproject/bignumber";
import { HashZero } from "@ethersproject/constants";

import { Order } from "../../order";
import { TakerOrderParams } from "../../types";
import { getCurrentTimestamp, getRandomBytes } from "../../../utils";

export interface BaseBuildParams {
  isOrderAsk: boolean;
  signer: string;
  collection: string;
  price: BigNumberish;
  nonce?: BigNumberish;
  startTime?: number;
  endTime?: number;
  minPercentageToAsk?: number;
  v?: number;
  r?: string;
  s?: string;
}

export abstract class BaseBuilder {
  public chainId: number;

  constructor(chainId: number) {
    if (chainId !== 1 && chainId !== 4) {
      throw new Error("Unsupported chain id");
    }

    this.chainId = chainId;
  }

  protected defaultInitialize(params: BaseBuildParams) {
    // Default listing time is 5 minutes in the past to allow for any
    // time discrepancies when checking the order's validity on-chain
    params.startTime = params.startTime ?? getCurrentTimestamp(-5 * 60);
    params.endTime = params.endTime ?? getCurrentTimestamp(365 * 24 * 60 * 60);
    params.minPercentageToAsk = params.minPercentageToAsk ?? 8500;
    params.nonce = params.nonce ?? getRandomBytes(10);
    params.v = params.v ?? 0;
    params.r = params.r ?? HashZero;
    params.s = params.s ?? HashZero;
  }

  public abstract isValid(order: Order): boolean;
  public abstract build(params: BaseBuildParams): Order;
  public abstract buildMatching(
    order: Order,
    taker: string,
    data: any
  ): TakerOrderParams;
}

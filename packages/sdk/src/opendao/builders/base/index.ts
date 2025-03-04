import { BigNumberish } from "@ethersproject/bignumber";
import { HashZero } from "@ethersproject/constants";

import { Order } from "../../order";
import { MatchParams } from "../../types";
import { getCurrentTimestamp, getRandomBytes } from "../../../utils";

export interface BaseBuildParams {
  direction: "sell" | "buy";
  contract: string;
  maker: string;
  price: BigNumberish;
  fees?: {
    recipient: string;
    amount: BigNumberish;
  }[];
  amount?: BigNumberish;
  expiry?: number;
  nonce?: BigNumberish;
  signatureType?: number;
  v?: number;
  r?: string;
  s?: string;
}

export interface BaseOrderInfo {}

export abstract class BaseBuilder {
  public chainId: number;

  constructor(chainId: number) {
    if (chainId !== 1 && chainId !== 4) {
      throw new Error("Unsupported chain id");
    }

    this.chainId = chainId;
  }

  protected defaultInitialize(params: BaseBuildParams) {
    params.fees = params.fees ?? [];
    params.expiry = params.expiry ?? getCurrentTimestamp(365 * 24 * 60 * 60);
    params.nonce = params.nonce ?? getRandomBytes();
    params.signatureType = params.signatureType ?? 2;
    params.v = params.v ?? 0;
    params.r = params.r ?? HashZero;
    params.s = params.s ?? HashZero;
  }

  public getInfo(_order: Order): BaseOrderInfo {
    return {};
  }

  public abstract isValid(order: Order): boolean;
  public abstract build(params: BaseBuildParams): Order;
  public abstract buildMatching(order: Order, data: any): MatchParams;
}

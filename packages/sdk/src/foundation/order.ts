import * as Types from "./types";
import { lc, s } from "../utils";

export class Order {
  public chainId: number;
  public params: Types.OrderParams;

  constructor(chainId: number, params: Types.OrderParams) {
    if (chainId !== 1) {
      throw new Error("Unsupported chain id");
    }

    this.chainId = chainId;

    try {
      this.params = normalize(params);
    } catch {
      throw new Error("Invalid params");
    }
  }
}

const normalize = (order: Types.OrderParams): Types.OrderParams => {
  // Perform some normalization operations on the order:
  // - convert bignumbers to strings where needed
  // - convert strings to numbers where needed
  // - lowercase all strings

  return {
    maker: lc(order.maker),
    contract: lc(order.contract),
    tokenId: s(order.tokenId),
    price: s(order.price),
  };
};

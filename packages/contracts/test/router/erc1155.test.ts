import { Contract } from "@ethersproject/contracts";
import { parseEther } from "@ethersproject/units";
import * as Sdk from "@reservoir0x/sdk/src";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { ethers } from "hardhat";

import {
  getChainId,
  getCurrentTimestamp,
  reset,
  setupNFTs,
  setupRouter,
} from "../utils";

describe("Router - filling ERC1155", () => {
  const chainId = getChainId();

  let deployer: SignerWithAddress;
  let referrer: SignerWithAddress;
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let carol: SignerWithAddress;

  let erc1155: Contract;
  let router: Sdk.Router.Router;

  beforeEach(async () => {
    [deployer, referrer, alice, bob, carol] = await ethers.getSigners();

    ({ erc1155 } = await setupNFTs(deployer));

    router = new Sdk.Router.Router(chainId, ethers.provider);
    if (!process.env.USE_DEPLOYED_ROUTER) {
      router.contract = await setupRouter(chainId, deployer);
    }
  });

  afterEach(reset);

  it("WyvernV23 - fill listing", async () => {
    const buyer = alice;
    const seller = bob;
    const feeRecipient = carol;

    const price = parseEther("1");
    const fee = 250;
    const routerFee = 100;
    const soldTokenId = 0;

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(soldTokenId);

    // Register user proxy for the seller
    const proxyRegistry = new Sdk.WyvernV23.Helpers.ProxyRegistry(
      ethers.provider,
      chainId
    );
    await proxyRegistry.registerProxy(seller);
    const proxy = await proxyRegistry.getProxy(seller.address);

    // Approve the user proxy
    await erc1155.connect(seller).setApprovalForAll(proxy, true);

    const exchange = new Sdk.WyvernV23.Exchange(chainId);
    const builder = new Sdk.WyvernV23.Builders.Erc1155.SingleToken.V2(chainId);

    // Build sell order
    let sellOrder = builder.build({
      maker: seller.address,
      contract: erc1155.address,
      tokenId: soldTokenId,
      side: "sell",
      price,
      paymentToken: Sdk.Common.Addresses.Eth[chainId],
      fee,
      feeRecipient: feeRecipient.address,
      listingTime: await getCurrentTimestamp(ethers.provider),
      nonce: await exchange.getNonce(ethers.provider, seller.address),
    });
    await sellOrder.sign(seller);

    await sellOrder.checkFillability(ethers.provider);

    const referrerEthBalanceBefore = await referrer.getBalance();
    const sellerEthBalanceBefore = await seller.getBalance();
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillListingsTx(
      [
        {
          kind: "wyvern-v2.3",
          contractKind: "erc1155",
          contract: erc1155.address,
          tokenId: soldTokenId.toString(),
          order: sellOrder,
        },
      ],
      buyer.address,
      {
        referrer: referrer.address,
        referrerFeeBps: routerFee,
      }
    );
    await buyer.sendTransaction(tx);

    const referrerEthBalanceAfter = await referrer.getBalance();
    const sellerEthBalanceAfter = await seller.getBalance();
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(referrerEthBalanceAfter.sub(referrerEthBalanceBefore)).to.eq(
      price.mul(routerFee).div(10000)
    );
    expect(sellerEthBalanceAfter.sub(sellerEthBalanceBefore)).to.eq(
      price.sub(price.mul(fee).div(10000))
    );
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await ethers.provider.getBalance(router.contract.address)).to.eq(0);
  });

  it("WyvernV23 - fill bid", async () => {
    const buyer = alice;
    const seller = bob;
    const feeRecipient = carol;

    const price = parseEther("1");
    const fee = 250;
    const boughtTokenId = 0;

    const weth = new Sdk.Common.Helpers.Weth(ethers.provider, chainId);

    // Mint weth to buyer
    await weth.deposit(buyer, price);

    // Approve the token transfer proxy for the buyer
    await weth.approve(
      buyer,
      Sdk.WyvernV23.Addresses.TokenTransferProxy[chainId]
    );

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(boughtTokenId);

    const exchange = new Sdk.WyvernV23.Exchange(chainId);
    const builder = new Sdk.WyvernV23.Builders.Erc1155.SingleToken.V2(chainId);

    // Build buy order
    let buyOrder = builder.build({
      maker: buyer.address,
      contract: erc1155.address,
      tokenId: boughtTokenId,
      side: "buy",
      price,
      paymentToken: Sdk.Common.Addresses.Weth[chainId],
      fee,
      feeRecipient: feeRecipient.address,
      listingTime: await getCurrentTimestamp(ethers.provider),
      nonce: await exchange.getNonce(ethers.provider, buyer.address),
    });
    await buyOrder.sign(buyer);

    await buyOrder.checkFillability(ethers.provider);

    const buyerWethBalanceBefore = await weth.getBalance(buyer.address);
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillBidTx(
      {
        kind: "wyvern-v2.3",
        contractKind: "erc1155",
        contract: erc1155.address,
        tokenId: boughtTokenId.toString(),
        order: buyOrder,
      },
      seller.address,
      {
        referrer: referrer.address,
      }
    );
    await seller.sendTransaction(tx);

    const buyerWethBalanceAfter = await weth.getBalance(buyer.address);
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(buyerWethBalanceBefore.sub(buyerWethBalanceAfter)).to.eq(price);
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await weth.getBalance(router.contract.address)).to.eq(0);
  });

  it("Seaport - fill listing", async () => {
    const buyer = alice;
    const seller = bob;
    const feeRecipient = carol;

    const price = parseEther("1");
    const fee = 250;
    const routerFee = 100;
    const soldTokenId = 0;

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(soldTokenId);

    // Approve the user ecchange
    await erc1155
      .connect(seller)
      .setApprovalForAll(Sdk.Seaport.Addresses.Exchange[chainId], true);

    // Build sell order
    const builder = new Sdk.Seaport.Builders.SingleToken(chainId);
    const sellOrder = builder.build({
      side: "sell",
      tokenKind: "erc1155",
      offerer: seller.address,
      contract: erc1155.address,
      tokenId: soldTokenId,
      paymentToken: Sdk.Common.Addresses.Eth[chainId],
      price: price.sub(price.mul(fee).div(10000)),
      fees: [
        {
          amount: price.mul(fee).div(10000),
          recipient: feeRecipient.address,
        },
      ],
      counter: 0,
      startTime: await getCurrentTimestamp(ethers.provider),
      endTime: (await getCurrentTimestamp(ethers.provider)) + 60,
    });
    await sellOrder.sign(seller);

    await sellOrder.checkFillability(ethers.provider);

    const referrerEthBalanceBefore = await referrer.getBalance();
    const sellerEthBalanceBefore = await seller.getBalance();
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillListingsTx(
      [
        {
          kind: "seaport",
          contractKind: "erc1155",
          contract: erc1155.address,
          tokenId: soldTokenId.toString(),
          order: sellOrder,
        },
      ],
      buyer.address,
      {
        referrer: referrer.address,
        referrerFeeBps: routerFee,
      }
    );
    await buyer.sendTransaction(tx);

    const referrerEthBalanceAfter = await referrer.getBalance();
    const sellerEthBalanceAfter = await seller.getBalance();
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(referrerEthBalanceAfter.sub(referrerEthBalanceBefore)).to.eq(
      price.mul(routerFee).div(10000)
    );
    expect(sellerEthBalanceAfter.sub(sellerEthBalanceBefore)).to.eq(
      price.sub(price.mul(fee).div(10000))
    );
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await ethers.provider.getBalance(router.contract.address)).to.eq(0);
  });

  it("LooksRare - fill listing", async () => {
    const buyer = alice;
    const seller = bob;

    const price = parseEther("1");
    const fee = 200;
    const routerFee = 100;
    const soldTokenId = 0;

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(soldTokenId);

    // Approve the transfer manager
    await erc1155
      .connect(seller)
      .setApprovalForAll(
        Sdk.LooksRare.Addresses.TransferManagerErc1155[chainId],
        true
      );

    const exchange = new Sdk.LooksRare.Exchange(chainId);
    const builder = new Sdk.LooksRare.Builders.SingleToken(chainId);

    // Build sell order
    let sellOrder = builder.build({
      isOrderAsk: true,
      signer: seller.address,
      collection: erc1155.address,
      tokenId: soldTokenId,
      price,
      startTime: await getCurrentTimestamp(ethers.provider),
      endTime: (await getCurrentTimestamp(ethers.provider)) + 60,
      nonce: await exchange.getNonce(ethers.provider, seller.address),
    });
    await sellOrder.sign(seller);

    await sellOrder.checkFillability(ethers.provider);

    const weth = new Sdk.Common.Helpers.Weth(ethers.provider, chainId);

    const referrerEthBalanceBefore = await referrer.getBalance();
    const sellerWethBalanceBefore = await weth.getBalance(seller.address);
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillListingsTx(
      [
        {
          kind: "looks-rare",
          contractKind: "erc1155",
          contract: erc1155.address,
          tokenId: soldTokenId.toString(),
          order: sellOrder,
        },
      ],
      buyer.address,
      {
        referrer: referrer.address,
        referrerFeeBps: routerFee,
      }
    );
    await buyer.sendTransaction(tx);

    const referrerEthBalanceAfter = await referrer.getBalance();
    const sellerWethBalanceAfter = await weth.getBalance(seller.address);
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(referrerEthBalanceAfter.sub(referrerEthBalanceBefore)).to.eq(
      price.mul(routerFee).div(10000)
    );
    expect(sellerWethBalanceAfter.sub(sellerWethBalanceBefore)).to.eq(
      price.sub(price.mul(fee).div(10000))
    );
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await ethers.provider.getBalance(router.contract.address)).to.eq(0);
    expect(await weth.getBalance(router.contract.address)).to.eq(0);
  });

  it("LooksRare - fill bid", async () => {
    const buyer = alice;
    const seller = bob;

    const price = parseEther("1");
    const boughtTokenId = 0;

    const weth = new Sdk.Common.Helpers.Weth(ethers.provider, chainId);

    // Mint weth to buyer
    await weth.deposit(buyer, price);

    // Approve the token transfer proxy for the buyer
    await weth.approve(buyer, Sdk.LooksRare.Addresses.Exchange[chainId]);

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(boughtTokenId);

    const exchange = new Sdk.LooksRare.Exchange(chainId);
    const builder = new Sdk.LooksRare.Builders.SingleToken(chainId);

    // Build buy order
    let buyOrder = builder.build({
      isOrderAsk: false,
      signer: buyer.address,
      collection: erc1155.address,
      tokenId: boughtTokenId,
      price,
      startTime: await getCurrentTimestamp(ethers.provider),
      endTime: (await getCurrentTimestamp(ethers.provider)) + 60,
      nonce: await exchange.getNonce(ethers.provider, buyer.address),
    });
    await buyOrder.sign(buyer);

    await buyOrder.checkFillability(ethers.provider);

    const buyerWethBalanceBefore = await weth.getBalance(buyer.address);
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillBidTx(
      {
        kind: "looks-rare",
        contractKind: "erc1155",
        contract: erc1155.address,
        tokenId: boughtTokenId.toString(),
        order: buyOrder,
      },
      seller.address,
      {
        referrer: referrer.address,
      }
    );
    await seller.sendTransaction(tx);

    const buyerWethBalanceAfter = await weth.getBalance(buyer.address);
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(buyerWethBalanceBefore.sub(buyerWethBalanceAfter)).to.eq(price);
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await weth.getBalance(router.contract.address)).to.eq(0);
  });

  it("ZeroExV4 - fill listing", async () => {
    const buyer = alice;
    const seller = bob;

    const price = parseEther("1");
    const routerFee = 0;
    const soldTokenId = 0;

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(soldTokenId);

    // Approve the exchange
    await erc1155
      .connect(seller)
      .setApprovalForAll(Sdk.ZeroExV4.Addresses.Exchange[chainId], true);

    const builder = new Sdk.ZeroExV4.Builders.SingleToken(chainId);

    // Build sell order
    const sellOrder = builder.build({
      direction: "sell",
      maker: seller.address,
      contract: erc1155.address,
      tokenId: soldTokenId,
      amount: 1,
      price,
      expiry: (await getCurrentTimestamp(ethers.provider)) + 60,
    });
    await sellOrder.sign(seller);

    await sellOrder.checkFillability(ethers.provider);

    const referrerEthBalanceBefore = await referrer.getBalance();
    const sellerEthBalanceBefore = await seller.getBalance();
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillListingsTx(
      [
        {
          kind: "zeroex-v4",
          contractKind: "erc1155",
          contract: erc1155.address,
          tokenId: soldTokenId.toString(),
          order: sellOrder,
        },
      ],
      buyer.address,
      {
        referrer: referrer.address,
        referrerFeeBps: routerFee,
      }
    );
    await buyer.sendTransaction(tx);

    const referrerEthBalanceAfter = await referrer.getBalance();
    const sellerEthBalanceAfter = await seller.getBalance();
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(referrerEthBalanceAfter.sub(referrerEthBalanceBefore)).to.eq(
      price.mul(routerFee).div(10000)
    );
    expect(sellerEthBalanceAfter.sub(sellerEthBalanceBefore)).to.eq(price);
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await ethers.provider.getBalance(router.contract.address)).to.eq(0);
  });

  it("ZeroExV4 - fill listings (batch buy)", async () => {
    const buyer = alice;
    const seller = bob;

    const price = parseEther("1");
    const routerFee = 200;
    const soldTokenId = 0;

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(soldTokenId);
    await erc1155.connect(seller).mint(soldTokenId);

    // Approve the exchange
    await erc1155
      .connect(seller)
      .setApprovalForAll(Sdk.ZeroExV4.Addresses.Exchange[chainId], true);

    const builder = new Sdk.ZeroExV4.Builders.SingleToken(chainId);

    const sellOrders: Sdk.ZeroExV4.Order[] = [];
    for (let i = 0; i < 2; i++) {
      // Build sell order
      const sellOrder = builder.build({
        direction: "sell",
        maker: seller.address,
        contract: erc1155.address,
        tokenId: soldTokenId,
        amount: 1,
        price,
        expiry: (await getCurrentTimestamp(ethers.provider)) + 60,
      });
      await sellOrder.sign(seller);

      await sellOrder.checkFillability(ethers.provider);

      sellOrders.push(sellOrder);
    }

    const referrerEthBalanceBefore = await referrer.getBalance();
    const sellerEthBalanceBefore = await seller.getBalance();
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(2);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillListingsTx(
      sellOrders.map((o) => ({
        kind: "zeroex-v4",
        contractKind: "erc1155",
        contract: erc1155.address,
        tokenId: o.params.nftId,
        order: o,
      })),
      buyer.address,
      {
        referrer: referrer.address,
        referrerFeeBps: routerFee,
      }
    );
    await buyer.sendTransaction(tx);

    const referrerEthBalanceAfter = await referrer.getBalance();
    const sellerEthBalanceAfter = await seller.getBalance();
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      soldTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      soldTokenId
    );
    expect(referrerEthBalanceAfter.sub(referrerEthBalanceBefore)).to.eq(
      price.mul(2).mul(routerFee).div(10000)
    );
    expect(sellerEthBalanceAfter.sub(sellerEthBalanceBefore)).to.eq(
      price.mul(2)
    );
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(2);

    // Router is stateless (it shouldn't keep any funds)
    expect(await ethers.provider.getBalance(router.contract.address)).to.eq(0);
  });

  it("ZeroExV4 - fill bid", async () => {
    const buyer = alice;
    const seller = bob;

    const price = parseEther("1");
    const boughtTokenId = 0;

    const weth = new Sdk.Common.Helpers.Weth(ethers.provider, 1);

    // Mint weth to buyer
    await weth.deposit(buyer, price);

    // Approve the exchange contract for the buyer
    await weth.approve(buyer, Sdk.ZeroExV4.Addresses.Exchange[1]);

    // Mint erc1155 to seller
    await erc1155.connect(seller).mint(boughtTokenId);

    const builder = new Sdk.ZeroExV4.Builders.SingleToken(chainId);

    // Build buy order
    const buyOrder = builder.build({
      direction: "buy",
      maker: buyer.address,
      contract: erc1155.address,
      tokenId: boughtTokenId,
      amount: 1,
      price,
      expiry: (await getCurrentTimestamp(ethers.provider)) + 60,
    });
    await buyOrder.sign(buyer);

    await buyOrder.checkFillability(ethers.provider);

    const buyerWethBalanceBefore = await weth.getBalance(buyer.address);
    const sellerNftBalanceBefore = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceBefore = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(sellerNftBalanceBefore).to.eq(1);
    expect(buyerNftBalanceBefore).to.eq(0);

    const tx = await router.fillBidTx(
      {
        kind: "zeroex-v4",
        contractKind: "erc1155",
        contract: erc1155.address,
        tokenId: boughtTokenId.toString(),
        order: buyOrder,
      },
      seller.address,
      {
        referrer: referrer.address,
      }
    );
    await seller.sendTransaction(tx);

    const buyerWethBalanceAfter = await weth.getBalance(buyer.address);
    const sellerNftBalanceAfter = await erc1155.balanceOf(
      seller.address,
      boughtTokenId
    );
    const buyerNftBalanceAfter = await erc1155.balanceOf(
      buyer.address,
      boughtTokenId
    );
    expect(buyerWethBalanceBefore.sub(buyerWethBalanceAfter)).to.eq(price);
    expect(sellerNftBalanceAfter).to.eq(0);
    expect(buyerNftBalanceAfter).to.eq(1);

    // Router is stateless (it shouldn't keep any funds)
    expect(await weth.getBalance(router.contract.address)).to.eq(0);
  });
});

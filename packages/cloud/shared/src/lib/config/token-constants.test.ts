/**
 * Unit tests for elizaOS token constants.
 * Validates exact network decimals, canonical EVM chain IDs, and exact ERC20 ABI
 * function signatures, mutability, and input/output shapes.
 */

import { describe, expect, it } from "vitest";
import { ELIZA_DECIMALS, ERC20_ABI, EVM_CHAINS } from "./token-constants.js";

describe("token-constants", () => {
  it("ELIZA_DECIMALS is 9 on all supported networks", () => {
    expect(ELIZA_DECIMALS.ethereum).toBe(9);
    expect(ELIZA_DECIMALS.base).toBe(9);
    expect(ELIZA_DECIMALS.bnb).toBe(9);
    expect(ELIZA_DECIMALS.solana).toBe(9);
  });

  it("EVM_CHAINS maps to canonical network configurations and chain IDs", () => {
    expect(EVM_CHAINS.ethereum.id).toBe(1);
    expect(EVM_CHAINS.ethereum.name).toBe("Ethereum");

    expect(EVM_CHAINS.base.id).toBe(8453);
    expect(EVM_CHAINS.base.name).toBe("Base");

    expect(EVM_CHAINS.bnb.id).toBe(56);
    expect(EVM_CHAINS.bnb.name).toBe("BNB Smart Chain");
  });

  it("ERC20_ABI contains exact canonical function definitions and shapes", () => {
    expect(Array.isArray(ERC20_ABI)).toBe(true);
    expect(ERC20_ABI).toHaveLength(3);

    // transfer(address to, uint256 amount) returns (bool)
    const transferFn = ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "transfer",
    );
    expect(transferFn).toBeDefined();
    expect(transferFn?.stateMutability).toBe("nonpayable");
    expect(transferFn?.inputs).toEqual([
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ]);
    expect(transferFn?.outputs).toEqual([{ type: "bool" }]);

    // balanceOf(address account) view returns (uint256)
    const balanceOfFn = ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "balanceOf",
    );
    expect(balanceOfFn).toBeDefined();
    expect(balanceOfFn?.stateMutability).toBe("view");
    expect(balanceOfFn?.inputs).toEqual([{ name: "account", type: "address" }]);
    expect(balanceOfFn?.outputs).toEqual([{ type: "uint256" }]);

    // decimals() view returns (uint8)
    const decimalsFn = ERC20_ABI.find(
      (item) => item.type === "function" && item.name === "decimals",
    );
    expect(decimalsFn).toBeDefined();
    expect(decimalsFn?.stateMutability).toBe("view");
    expect(decimalsFn?.inputs).toEqual([]);
    expect(decimalsFn?.outputs).toEqual([{ type: "uint8" }]);
  });
});

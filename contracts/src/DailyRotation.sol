// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAbxAugmentHook} from "abx-contracts/src/extensions/configurable-params/IAbxParamHooks.sol";

/**
 * DailyRotation -- turns a static generative token into a puzzle that turns over on a clock.
 *
 * The whole mechanism is one `view`: report the current period index as `day`. The resolver
 * reads it fresh on every view of the live view, so the artwork rotates with no transaction,
 * no scheduler, and nothing running off-chain. Because live data never re-addresses a render,
 * the marketplace thumbnail keeps snapshotting settled state instead of churning every period.
 *
 * The value is deliberately NOT a calendar date: days-to-Y/M/D conversion on-chain is a pile
 * of arithmetic that can only be wrong, and the consumer can derive the date from the index
 * for free. `period` is immutable and set at construction (86400 for a real daily) so a short
 * period can be deployed to a testnet to watch a rotation happen without waiting a day.
 */
contract DailyRotation is IAbxAugmentHook {
    /**
     * The tokenData key this hook supplies. Declared rather than cast inline so the width is
     * fixed at the declaration: an ASCII key is right-padded into bytes32, and anything longer
     * than 32 bytes would be TRUNCATED silently, landing under a different key than intended.
     * "day" is 3 bytes, so there is nothing to truncate — but a future key must stay ≤ 32.
     */
    bytes32 private constant K_DAY = "day";

    /// Seconds per rotation. 86400 = a UTC day, the boundary a "daily" is expected to turn on.
    uint256 public immutable period;

    error PeriodZero();

    constructor(uint256 period_) {
        if (period_ == 0) revert PeriodZero();
        period = period_;
    }

    /// The current period index -- days since the Unix epoch when `period` is 86400.
    function currentDay() public view returns (uint256) {
        return block.timestamp / period;
    }

    /**
     * Every token in the collection shares one rotation, so the arguments are unused: the
     * point of this hook is that the whole collection is looking at the same puzzle today.
     * A per-token variant would mix `tokenId` in here instead.
     */
    function augmentTokenParams(address, uint256) external view returns (AugmentedParam[] memory entries) {
        entries = new AugmentedParam[](1);
        entries[0] = AugmentedParam({key: K_DAY, value: _toString(currentDay())});
    }

    /// Minimal uint -> decimal string; avoids pulling a dependency in for one call.
    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 digits;
        for (uint256 n = v; n != 0; n /= 10) digits++;
        bytes memory buf = new bytes(digits);
        while (v != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + (v % 10)));
            v /= 10;
        }
        return string(buf);
    }
}

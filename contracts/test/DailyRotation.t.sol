// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IAbxAugmentHook} from "abx-contracts/src/extensions/configurable-params/IAbxParamHooks.sol";
import {DailyRotation} from "../src/DailyRotation.sol";

contract DailyRotationTest is Test {
    DailyRotation daily;

    uint256 constant DAY = 86400;

    // The keys under test, as constants for the same reason the contract uses one: an inline
    // bytes32("…") cast of an over-long literal truncates silently.
    bytes32 constant K_DAY = "day";
    bytes32 constant K_SEED = "seed";
    bytes32 constant K_TOKEN_ID = "tokenId";
    bytes32 constant K_CHAIN_ID = "chainId";
    bytes32 constant K_CONTRACT = "contractAddress";

    function setUp() public {
        daily = new DailyRotation(DAY);
    }

    // ------------------------------------------------------------ the contract shape

    function test_ReturnsExactlyOneEntryKeyedDay() public view {
        IAbxAugmentHook.AugmentedParam[] memory e = daily.augmentTokenParams(address(0xBEEF), 7);
        assertEq(e.length, 1, "one entry");
        // ASCII right-padded into bytes32 -- what the resolver trims back to "day".
        assertEq(e[0].key, K_DAY, "key is `day`");
    }

    /// The resolver skips reserved coordinates, so a hook must never spend an entry on one.
    function test_NeverEmitsAReservedCoordinate() public view {
        IAbxAugmentHook.AugmentedParam[] memory e = daily.augmentTokenParams(address(0xBEEF), 7);
        for (uint256 i = 0; i < e.length; i++) {
            assertTrue(e[i].key != K_SEED, "must not claim seed");
            assertTrue(e[i].key != K_TOKEN_ID, "must not claim tokenId");
            assertTrue(e[i].key != K_CHAIN_ID, "must not claim chainId");
            assertTrue(e[i].key != K_CONTRACT, "must not claim contractAddress");
        }
    }

    function test_RevertsOnZeroPeriod() public {
        vm.expectRevert(DailyRotation.PeriodZero.selector);
        new DailyRotation(0);
    }

    // ------------------------------------------------------------------ the rotation

    /// The whole point: the value must flip at the boundary and be flat in between.
    function test_FlipsExactlyAtThePeriodBoundary() public {
        uint256 boundary = 20669 * DAY; // 2026-08-04T00:00:00Z

        vm.warp(boundary - 1);
        string memory before = _value();
        assertEq(before, "20668", "the second before midnight is still yesterday");

        vm.warp(boundary);
        assertEq(_value(), "20669", "flips exactly at midnight");

        vm.warp(boundary + DAY - 1);
        assertEq(_value(), "20669", "flat for the whole day");

        vm.warp(boundary + DAY);
        assertEq(_value(), "20670", "and again the next midnight");
    }

    function test_EveryTokenSeesTheSameDay() public {
        vm.warp(20669 * DAY + 12 hours);
        assertEq(
            daily.augmentTokenParams(address(0xA), 0)[0].value,
            daily.augmentTokenParams(address(0xB), 99)[0].value,
            "one collection, one puzzle today"
        );
    }

    function test_ShortPeriodRotatesFast() public {
        DailyRotation fast = new DailyRotation(60);
        vm.warp(600);
        assertEq(fast.augmentTokenParams(address(0), 0)[0].value, "10");
        vm.warp(659);
        assertEq(fast.augmentTokenParams(address(0), 0)[0].value, "10", "flat inside the minute");
        vm.warp(660);
        assertEq(fast.augmentTokenParams(address(0), 0)[0].value, "11", "flips on the minute");
    }

    /// Monotonic and never repeating: a puzzle must not silently come back around.
    function testFuzz_MonotonicInTime(uint32 t0, uint32 delta) public {
        vm.assume(delta > 0);
        uint256 a = uint256(t0);
        uint256 b = a + uint256(delta);

        vm.warp(a);
        uint256 dayA = daily.currentDay();
        vm.warp(b);
        uint256 dayB = daily.currentDay();

        assertGe(dayB, dayA, "day index never goes backwards as time advances");
    }

    // ------------------------------------------------------------- the string encoding

    function test_DecimalEncoding() public {
        assertEq(_at(0), "0");
        assertEq(_at(1 * DAY), "1");
        assertEq(_at(9 * DAY), "9");
        assertEq(_at(10 * DAY), "10");
        assertEq(_at(20669 * DAY), "20669");
        assertEq(_at(100000 * DAY), "100000");
    }

    /// The consumer parses this with /^\d{1,7}$/ and Number(); it must stay plain decimal.
    function testFuzz_EncodingRoundTrips(uint40 ts) public {
        vm.warp(uint256(ts));
        string memory s = _value();
        assertEq(bytes(s).length > 0, true, "never empty");
        assertEq(_parse(s), daily.currentDay(), "decodes back to the same number");
    }

    // ------------------------------------------------------------------------ helpers

    function _value() internal view returns (string memory) {
        return daily.augmentTokenParams(address(0xBEEF), 7)[0].value;
    }

    function _at(uint256 ts) internal returns (string memory) {
        vm.warp(ts);
        return _value();
    }

    function _parse(string memory s) internal pure returns (uint256 n) {
        bytes memory b = bytes(s);
        for (uint256 i = 0; i < b.length; i++) {
            uint8 c = uint8(b[i]);
            require(c >= 48 && c <= 57, "non-digit in output");
            n = n * 10 + (c - 48);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {DailySurfaces} from "../src/DailySurfaces.sol";

/**
 * The interface's five invariants are load-bearing: the ABX metadata renderer staticcalls
 * render() with NO try/catch, so a revert or a wrong content type bricks the entire
 * tokenURI -- not just the one field. These tests are that guarantee.
 */
contract DailySurfacesTest is Test {
    DailySurfaces s;

    uint256 constant COLLECTION = type(uint256).max;
    bytes32 constant F_IMAGE = "image";
    bytes32 constant F_ATTRS = "attributes";

    function setUp() public {
        s = new DailySurfaces();
    }

    // ------------------------------------------------- invariant 2: content types

    function test_ImageContentType() public view {
        (string memory ct, bytes memory data) = s.render(address(0xA), 0, F_IMAGE);
        assertEq(ct, "image/svg+xml");
        assertTrue(data.length > 0, "non-empty");
        assertEq(_slice(data, 0, 4), "<svg", "is an svg");
        assertEq(_slice(data, data.length - 6, 6), "</svg>", "closed");
    }

    function test_AttributesContentType() public view {
        (string memory ct, bytes memory data) = s.render(address(0xA), 0, F_ATTRS);
        assertEq(ct, "application/json");
        assertEq(_slice(data, 0, 1), "[", "json array");
        assertEq(_slice(data, data.length - 1, 1), "]", "closed");
    }

    /// The attributes must carry exactly the three series-level traits sudoku.js reports.
    function test_AttributesAreTheSeriesLevelSet() public view {
        (, bytes memory data) = s.render(address(0xA), 0, F_ATTRS);
        string memory json = string(data);
        assertTrue(vm.contains(json, '"trait_type":"Rotation","value":"Daily"'), "Rotation");
        assertTrue(vm.contains(json, '"trait_type":"Solutions","value":"Exactly one"'), "Solutions");
        assertTrue(vm.contains(json, '"trait_type":"Program","value":"On-chain"'), "Program");
    }

    /// The whole reason these are series-level: no per-puzzle key may appear.
    function test_AttributesCarryNothingThatExpires() public view {
        (, bytes memory data) = s.render(address(0xA), 0, F_ATTRS);
        string memory json = string(data);
        assertFalse(vm.contains(json, "Difficulty"), "Difficulty expires daily");
        assertFalse(vm.contains(json, "Givens"), "Givens expires daily");
        assertFalse(vm.contains(json, "Symmetry"), "Symmetry expires daily");
        assertFalse(vm.contains(json, "Palette"), "Palette expires daily");
    }

    // ------------------------------------- invariants 1 + 4: never revert, deterministic

    function test_CollectionSurfaceRenders() public view {
        (string memory ctI, bytes memory di) = s.render(address(0xA), COLLECTION, F_IMAGE);
        assertEq(ctI, "image/svg+xml");
        assertTrue(di.length > 0);
        (string memory ctA, bytes memory da) = s.render(address(0xA), COLLECTION, F_ATTRS);
        assertEq(ctA, "application/json");
        assertTrue(da.length > 0);
    }

    /// Never revert on a supported field, for ANY token or id — including the collection id.
    function testFuzz_NeverRevertsOnSupportedFields(address token, uint256 tokenId) public view {
        (, bytes memory a) = s.render(token, tokenId, F_IMAGE);
        (, bytes memory b) = s.render(token, tokenId, F_ATTRS);
        assertTrue(a.length > 0 && b.length > 0);
    }

    function testFuzz_IdenticalForEveryTokenAndId(address t1, uint256 i1, address t2, uint256 i2)
        public
        view
    {
        (, bytes memory a) = s.render(t1, i1, F_ATTRS);
        (, bytes memory b) = s.render(t2, i2, F_ATTRS);
        assertEq(keccak256(a), keccak256(b), "attributes are invariant");
        (, bytes memory c) = s.render(t1, i1, F_IMAGE);
        (, bytes memory d) = s.render(t2, i2, F_IMAGE);
        assertEq(keccak256(c), keccak256(d), "cover is invariant");
    }

    // -------------------------------------------- invariant 3: unsupported fields only

    function testFuzz_RevertsOnlyOnUnsupportedFields(bytes32 field) public {
        vm.assume(field != F_IMAGE && field != F_ATTRS);
        vm.expectRevert(abi.encodeWithSelector(DailySurfaces.UnsupportedField.selector, field));
        s.render(address(0xA), 0, field);
    }

    // ------------------------------------------------------ invariant 5: bounded output

    function test_OutputStaysCheapToRead() public {
        (, bytes memory img) = s.render(address(0xA), 0, F_IMAGE);
        (, bytes memory att) = s.render(address(0xA), 0, F_ATTRS);
        // tokenURI base64s these inline, so both ride in every read. Keep them small.
        assertLt(img.length, 1024, "cover under 1KB");
        assertLt(att.length, 512, "attributes under 512B");
        emit log_named_uint("cover bytes", img.length);
        emit log_named_uint("attributes bytes", att.length);
    }

    function _slice(bytes memory b, uint256 start, uint256 len)
        private
        pure
        returns (string memory)
    {
        bytes memory out = new bytes(len);
        for (uint256 i = 0; i < len; i++) out[i] = b[start + i];
        return string(out);
    }
}

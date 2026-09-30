// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAbxFieldRenderer} from "abx-contracts/src/uri/IAbxFieldRenderer.sol";

/**
 * DailySurfaces -- the `image` and `attributes` fields for ABXdoku Daily, on-chain.
 *
 * A rotating token can't put today's puzzle in cached metadata: by tomorrow "Fiendish ·
 * 24 given" is false, and a stale trait reads as a fact. So both surfaces here state only
 * what is true of EVERY puzzle the token will ever show. That makes them constants, which
 * is why this contract can be pure data with no seed math -- and why it can be on-chain at
 * all. An attributes renderer that had to report today's difficulty would need the whole
 * sudoku generator in Solidity; one that reports what never changes needs none of it.
 *
 * Consequence worth stating plainly: the thumbnail is a COVER, not a picture of today's
 * board. That is deliberate. A screenshot would be a picture of one particular day, frozen
 * the moment it was captured and wrong forever after -- renders are addressed by settled
 * state, and the day is live data that never re-addresses them, so nothing would ever
 * refresh it. A cover is honest at every point in time and costs nothing to keep true.
 *
 * COHERENCE RULE (the scaffold's, and it applies here): these attributes must say the same
 * thing as the artwork's own `abx.traits({...})` call in sudoku.js. If one changes, change
 * both. They are duplicated because one is read by a marketplace off-chain and the other by
 * the resolver from the running program; nothing enforces the agreement but us.
 */
contract DailySurfaces is IAbxFieldRenderer {
    error UnsupportedField(bytes32 field);

    bytes32 private constant F_IMAGE = "image";
    bytes32 private constant F_ATTRIBUTES = "attributes";

    string private constant CT_SVG = "image/svg+xml";
    string private constant CT_JSON = "application/json";

    /// The collection surface (`contractURI`), which must render rather than revert.
    uint256 private constant COLLECTION = type(uint256).max;

    /// Palette is the artwork's own "Blueprint": ground #0a2138, givens #dfeefc, placed #ffd166.
    bytes private constant COVER =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" width="400" height="400">'
        '<rect width="400" height="400" fill="#0a2138"/>'
        '<g stroke="#4d7ea8" stroke-width="2" fill="none">'
        '<path d="M80 60h240v240H80z"/><path d="M160 60v240M240 60v240M80 140h240M80 220h240"/>'
        "</g>"
        '<text x="200" y="352" fill="#dfeefc" font-family="ui-monospace,monospace" font-size="30"'
        ' font-weight="700" text-anchor="middle">ABXDOKU</text>'
        '<text x="200" y="381" fill="#ffd166" font-family="ui-monospace,monospace" font-size="16"'
        ' letter-spacing="4" text-anchor="middle">DAILY</text>'
        "</svg>";

    /// Must mirror sudoku.js: {Rotation: Daily, Solutions: Exactly one, Program: On-chain}.
    bytes private constant ATTRIBUTES = '[{"trait_type":"Rotation","value":"Daily"},'
        '{"trait_type":"Solutions","value":"Exactly one"},'
        '{"trait_type":"Program","value":"On-chain"}]';

    /**
     * Neither field depends on the token or the id -- the whole point is that they are
     * invariant -- so both arguments are unused and no chain read happens at all.
     *
     * Invariant 1 (never revert) is satisfied for both supported fields including the
     * collection surface; invariant 3 permits reverting a field we were never wired for,
     * which can only be a deploy-time miswiring.
     */
    function render(address, uint256, bytes32 field)
        external
        pure
        returns (string memory contentType, bytes memory data)
    {
        if (field == F_IMAGE) return (CT_SVG, COVER);
        if (field == F_ATTRIBUTES) return (CT_JSON, ATTRIBUTES);
        revert UnsupportedField(field);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {DailySurfaces} from "../src/DailySurfaces.sol";

/// Writes the cover exactly as the compiled contract returns it, so it can be eyeballed
/// before it is deployed. `forge script script/DumpCover.s.sol`
contract DumpCover is Script {
    function run() external {
        DailySurfaces s = new DailySurfaces();
        (, bytes memory svg) = s.render(address(0), 0, "image");
        vm.writeFile("./out/cover.svg", string(svg));
        (, bytes memory att) = s.render(address(0), 0, "attributes");
        vm.writeFile("./out/attributes.json", string(att));
    }
}

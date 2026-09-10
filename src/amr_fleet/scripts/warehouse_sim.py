#!/usr/bin/env python3
"""Warehouse grid simulation node.

Owns the warehouse display.  Subscribes to every /robot{N}/state topic
(README sections 5 & 11), renders the shared grid together with robot
positions (R1/R2/R3), goals (G) and static obstacles (#), and prints the
active communication graph between robots once per second.

A companion console_script of the amr_fleet package, run as:

    ros2 run amr_fleet warehouse_sim
"""

import os
import sys
from datetime import datetime, timezone

import rclpy
from rclpy.node import Node
from rclpy.qos import HistoryPolicy, QoSProfile, ReliabilityPolicy

from amr_fleet_msgs.msg import RobotState

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from robot_node import (  # noqa: E402  (shared warehouse model)
    GOALS,
    GRID_H,
    GRID_W,
    ROBOT_IDS,
    SPAWNS,
    WAREHOUSE_MAP,
)

DISPLAY_FPS = 8.0


def render_frame(states: dict) -> str:
    grid = [list(row) for row in WAREHOUSE_MAP]

    for rid, (gx, gy) in GOALS.items():
        col = (int(gx), int(GRID_H - 1 - int(gy)))
        if 0 <= col[0] < GRID_W and 0 <= col[1] < GRID_H and grid[col[1]][col[0]] == '.':
            grid[col[1]][col[0]] = 'G'

    for rid in ROBOT_IDS:
        s = states.get(rid)
        if s is None:
            continue
        cx = int(s.x)
        cy = int(GRID_H - 1 - int(s.y))
        label = "R" + str(s.robot_num)
        if 0 <= cx < GRID_W and 0 <= cy < GRID_H:
            grid[cy][cx] = label

    lines = ["".join(row) for row in grid]

    # header grid coordinates
    out = ["      " + "".join(f"{i % 10}" for i in range(GRID_W))]
    for i, row in enumerate(lines):
        y = GRID_H - i
        out.append(f"{y:>4} |{row}|")
    out.append("      " + "-" * GRID_W)

    out.append("  " + "  ".join(f"{r}: ({states[r].x:.1f},{states[r].y:.1f}) at=({states[r].goal_x:.0f},{states[r].goal_y:.0f})"
                if r in states else f"{r}: offline" for r in ROBOT_IDS))
    return "\n".join(out)


class WarehouseSimNode(Node):
    def __init__(self):
        super().__init__("warehouse_sim")
        qos = QoSProfile(
            depth=1,
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
        )
        self._states: dict[str, RobotState] = {}
        for rid in ROBOT_IDS:
            self.create_subscription(RobotState, f"/{rid}/state",
                                     self._make_cb(rid), qos)
        self.create_timer(1.0 / DISPLAY_FPS, self._render)
        self.get_logger().info("warehouse grid sim ready")
        self._last_comm_print = 0.0

    def _make_cb(self, rid):
        def cb(msg: RobotState):
            self._states[rid] = msg
        return cb

    def _render(self):
        now = datetime.now(timezone.utc).timestamp()
        os.system("clear")
        print(render_frame(self._states))
        if now - self._last_comm_print > 1.0:
            self._last_comm_print = now
            online = sorted(r for r in ROBOT_IDS if r in self._states)
            print("communication graph: " + " <-> ".join(online) if online else "no robots online yet")
        sys.stdout.flush()


def main(argv=None):
    rclpy.init(args=argv if argv is not None else sys.argv[1:])
    try:
        node = WarehouseSimNode()
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        rclpy.shutdown()


if __name__ == "__main__":
    main()
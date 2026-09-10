"""Launch the entire 3-AMR warehouse demo (single container mode).

Equivalent of docker-compose, but runs all four ROS nodes from one process
tree. Useful for quickly testing behaviour before scaling to separate
containers/boards.
"""

import os
from launch import LaunchDescription
from launch.actions import ExecuteProcess
from launch_ros.actions import Node


def generate_launch_description():
    prefix = os.environ.get("ROS_DOMAIN_ID", "42")
    package = "amr_fleet"

    robots = []
    for rid in ("robot1", "robot2", "robot3"):
        robots.append(
            Node(
                package=package,
                executable="robot_node",
                namespace="/" + rid,
                name=f"{rid}_node",
                parameters=[{"goal_x": 0.0, "goal_y": 0.0}],
                arguments=["--namespace", rid],
            )
        )

    sim = Node(package=package, executable="warehouse_sim", name="warehouse_sim")

    return LaunchDescription(robots + [sim])
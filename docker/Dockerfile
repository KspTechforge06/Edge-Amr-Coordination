FROM ros:humble-ros-base-jammy

ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3-pip \
    python3-colcon-common-extensions \
    python3-rosdep \
    python3-tk \
    lm-sensors \
    net-tools \
    iputils-ping \
    curl \
    vim \
    tmux \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python ML dependencies for GNN
RUN pip3 install --no-cache-dir \
    numpy \
    torch --index-url https://download.pytorch.org/whl/cpu \
    && pip3 install --no-cache-dir "setuptools==59.6.0" \
    && rm -rf /root/.cache/pip

# Source ROS setup every shell invocation
RUN echo "source /opt/ros/humble/setup.bash" >> /root/.bashrc
RUN echo "export ROS_DOMAIN_ID=42" >> /root/.bashrc
RUN echo "export RMW_IMPLEMENTATION=rmw_fastrtps_cpp" >> /root/.bashrc

# Create workspace
RUN mkdir -p /amr_fleet_ws/src
WORKDIR /amr_fleet_ws

COPY src/ /amr_fleet_ws/src/

# Build the workspace
RUN /bin/bash -c "source /opt/ros/humble/setup.bash && colcon build --symlink-install"

RUN echo "source /amr_fleet_ws/install/setup.bash" >> /root/.bashrc

WORKDIR /amr_fleet_ws

CMD ["/bin/bash"]
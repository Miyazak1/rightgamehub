# MOOYU Courseware Mission Workbench

Reusable presentation shell for composite learning missions.

The package owns route presentation, visible pressure, calculation controls, feedback and debrief. It does not calculate subject answers or decide success. Those responsibilities remain in Domain modules and the Mission Engine.

`createMissionWorkbench(...)` accepts a runtime, a mission module id, an evidence model and a mission-specific experience description. The experience description may change the story and controls without changing the mission protocol.

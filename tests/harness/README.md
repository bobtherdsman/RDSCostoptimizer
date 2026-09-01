# Harness Tests

The cost harness is an independent regression oracle for the standalone RDS Cost Optimization project.

It exists to prove that production recommendations remain correct after every change. It is not production recommendation logic and must not choose candidates, supply production formulas at runtime, or import the production calculation that it is meant to verify.

Harness tests should cover:

- independent reproduction of CPU, memory, I/O, tempdb, edition, orderability, and evidence-window gates
- tamper detection for preserved result evidence
- fail-closed behavior for unsafe or unreproducible recommendations
- independence from SSATWeb sizing logic

See `documentation/HARNESS_CONTRACT.md` at the project root for the governing contract.

export class GoalReadGeneration {
  private generation = 0;

  begin() {
    return this.generation;
  }

  invalidate() {
    this.generation += 1;
  }

  isCurrent(generation: number) {
    return generation === this.generation;
  }
}

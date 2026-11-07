import { Component, type ReactNode } from "react";
export class AppBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <main className="boot" role="alert">
        <h1>This view couldn’t open</h1>
        <p>Your saved chats and office are safe.</p>
        <button
          className="secondary"
          onClick={() => this.setState({ error: false })}
        >
          Reopen workspace
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}

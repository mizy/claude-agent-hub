/**
 * Simple Hello World function for testing
 */
export function helloWorld(name?: string): string {
  if (name !== undefined) {
    return `Hello, ${name}!`;
  }
  return 'Hello, World!';
}

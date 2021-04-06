/**
 * @file        deny-node.js
 *              Prevent users from accidentally running the evaluator under NodeJS.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Mar 2021
 */
if (typeof __evaluator === 'object' && __evaluator.type === 'node') {
  if (typeof writeln === 'function')
    writeln('LOG:Sandbox definition not suitable for Node evaluator - exiting');
  if (typeof console === 'object')
    console.error('Sandbox definition not suitable for Node evaluator - exiting');
  debugger; // allow-debugger
  die(99);
}

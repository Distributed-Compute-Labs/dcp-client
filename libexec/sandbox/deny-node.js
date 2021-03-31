/**
 * @file        deny-node.js
 *              Prevent users from accidentally running the evaluator under NodeJS.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Mar 2021
 */
if (typeof __evaluator === 'object' && __evaluator.type === 'node') {
  writeln('LOG:Sandbox definition not suitable Node evaluator - exiting');
  die(99);
}

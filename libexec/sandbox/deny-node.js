/**
 * @file        deny-node.js
 *              Prevent users from accidentally running the evaluator under NodeJS.
 *
 * @author      Wes Garland, wes@kingsds.network
 * @date        Mar 2021
 */
if (__evaluator && __evaluator.type === 'node') {
  writeln('Sandbox definitions note suitable Node evaluator - exiting');
  die(99);
}

#!/usr/bin/env bash
#
# @file         ¬fetch.bash
#		This test attempts to use NodeJS' globally defined
#		fetch function after the access lists has been applied
#		which should not work.
#
#		This test wraps the test file "attempt-to-fetch.js"
#		since Peter gets confused when running files code
# 		where globalThis is modified and `process` is removed.
#
# @author       Will Pringle, will@distributive.network
# @date         Dec 2023

node attempt-to-fetch.js


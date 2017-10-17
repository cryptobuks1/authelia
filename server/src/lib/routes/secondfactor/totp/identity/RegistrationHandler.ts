
import express = require("express");
import BluebirdPromise = require("bluebird");
import objectPath = require("object-path");

import { Identity } from "../../../../../../types/Identity";
import { IdentityValidable } from "../../../../IdentityCheckMiddleware";
import { PRE_VALIDATION_TEMPLATE } from "../../../../IdentityCheckPreValidationTemplate";
import Constants = require("../constants");
import Endpoints = require("../../../../../../../shared/api");
import ErrorReplies = require("../../../../ErrorReplies");
import AuthenticationSession = require("../../../../AuthenticationSession");
import UserMessages = require("../../../../../../../shared/UserMessages");
import FirstFactorValidator = require("../../../../FirstFactorValidator");
import { IRequestLogger } from "../../../../logging/IRequestLogger";
import { IUserDataStore } from "../../../../storage/IUserDataStore";
import { ITotpHandler } from "../../../../authentication/totp/ITotpHandler";


export default class RegistrationHandler implements IdentityValidable {
  private logger: IRequestLogger;
  private userDataStore: IUserDataStore;
  private totp: ITotpHandler;

  constructor(logger: IRequestLogger,
    userDataStore: IUserDataStore,
    totp: ITotpHandler) {
    this.logger = logger;
    this.userDataStore = userDataStore;
    this.totp = totp;
  }

  challenge(): string {
    return Constants.CHALLENGE;
  }

  private retrieveIdentity(req: express.Request): BluebirdPromise<Identity> {
    return AuthenticationSession.get(req, this.logger)
      .then(function (authSession) {
        const userid = authSession.userid;
        const email = authSession.email;

        if (!(userid && email)) {
          return BluebirdPromise.reject(new Error("User ID or email is missing"));
        }

        const identity = {
          email: email,
          userid: userid
        };
        return BluebirdPromise.resolve(identity);
      });
  }

  preValidationInit(req: express.Request): BluebirdPromise<Identity> {
    const that = this;
    return FirstFactorValidator.validate(req, this.logger)
      .then(function () {
        return that.retrieveIdentity(req);
      });
  }

  preValidationResponse(req: express.Request, res: express.Response) {
    res.render(PRE_VALIDATION_TEMPLATE);
  }

  postValidationInit(req: express.Request) {
    return FirstFactorValidator.validate(req, this.logger);
  }

  postValidationResponse(req: express.Request, res: express.Response): BluebirdPromise<void> {
    const that = this;
    return AuthenticationSession.get(req, this.logger)
      .then(function (authSession) {
        const userid = authSession.identity_check.userid;
        const challenge = authSession.identity_check.challenge;

        if (challenge != Constants.CHALLENGE || !userid) {
          return BluebirdPromise.reject(new Error("Bad challenge."));
        }
        const secret = that.totp.generate();
        that.logger.debug(req, "Save the TOTP secret in DB");
        return that.userDataStore.saveTOTPSecret(userid, secret)
          .then(function () {
            AuthenticationSession.reset(req);

            res.render(Constants.TEMPLATE_NAME, {
              base32_secret: secret.base32,
              otpauth_url: secret.otpauth_url,
              login_endpoint: Endpoints.FIRST_FACTOR_GET
            });
          });
      })
      .catch(ErrorReplies.replyWithError200(req, res, that.logger, UserMessages.OPERATION_FAILED));
  }

  mailSubject(): string {
    return "Register your TOTP secret key";
  }
}